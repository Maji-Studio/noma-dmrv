/**
 * CreditBatchList component
 * Card grid layout with operational filters and pagination. There is deliberately no
 * lifecycle-status column or filter: every batch sits at the DB default
 * ("pending") with no transition path, so a status surface only competed with
 * the real readiness signal (QA 2026-07-21 F3). Reintroduce one when a registry
 * lifecycle actually drives it.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CertificateIcon,
  LeafIcon,
  PlusIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { useToast } from "@/components/ui/toast";
import {
  Button,
  DEFAULT_PAGE_SIZE,
  EmptyState,
  ListPagination,
  PageHeader,
} from "@/components/ui";
import { ServerError } from "@/components/forms";
import { CreditBatchForm } from "./credit-batch-form";
import { CreditBatchCard } from "./credit-batch-card";
import {
  CreditBatchFilters,
  type CreditBatchReadinessFilter,
} from "./credit-batch-filters";
import { filterCreditBatches } from "./credit-batch-filtering";
import {
  useCreditBatches,
  useCreditBatchCo2eStoredPreviews,
  useCreateCreditBatch,
  useUpdateCreditBatch,
  useDeleteCreditBatch,
} from "@/hooks/use-credit-batches";
import { useCreditBatchHealthSummaries } from "@/hooks/use-certification";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { SelectFacilityEmptyState } from "@/components/navigation";

// ============================================
// Helpers
// ============================================

const EMPTY_CREDIT_BATCHES: CreditBatchWithRelations[] = [];

// ============================================
// Component
// ============================================

export function CreditBatchList({ canManage = false }: { canManage?: boolean }) {
  // Filter & pagination state
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [selectedFeedstockIds, setSelectedFeedstockIds] = useState<string[]>([]);
  const [readinessFilter, setReadinessFilter] =
    useState<CreditBatchReadinessFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: CreditBatchWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const router = useRouter();
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Data fetching — facility-scoped so batches never leak across facilities
  const { data: creditBatches, isLoading: batchesLoading, error } = useCreditBatches(
    contextFacilityId ?? undefined
  );
  const createCreditBatch = useCreateCreditBatch();
  const updateCreditBatch = useUpdateCreditBatch();
  const deleteCreditBatch = useDeleteCreditBatch();
  const toast = useToast();

  // Facility-scoped facets. A credit batch has exactly one feedstock, so the
  // feedstock multi-select is an OR filter across the selected catalogue ids.
  const allItems = creditBatches ?? EMPTY_CREDIT_BATCHES;
  const allBatchIds = allItems.map((batch) => batch.id);
  const facetFilteredItems = filterCreditBatches(allItems, {}, {
    startDate: startDateFilter,
    endDate: endDateFilter,
    feedstockTypeIds: selectedFeedstockIds,
    readiness: "all",
  });
  const facetTotalPages = Math.max(
    1,
    Math.ceil(facetFilteredItems.length / pageSize),
  );
  const facetPage = Math.min(currentPage, facetTotalPages);
  const visibleFacetIds = facetFilteredItems
    .slice((facetPage - 1) * pageSize, facetPage * pageSize)
    .map((batch) => batch.id);
  // Card pills need only the visible page. A readiness filter necessarily
  // widens the request to the date/feedstock candidate set so filtering stays
  // accurate without walking every batch on ordinary list loads.
  const healthBatchIds = readinessFilter === "all"
    ? visibleFacetIds
    : facetFilteredItems.map((batch) => batch.id);
  const {
    data: batchHealthSummaries = {},
    isLoading: healthLoading,
    error: healthError,
  } =
    useCreditBatchHealthSummaries(
      contextFacilityId ?? undefined,
      healthBatchIds,
    );
  const listLoading =
    batchesLoading || (readinessFilter !== "all" && healthLoading);
  const filteredItems = filterCreditBatches(
    facetFilteredItems,
    Object.fromEntries(
      healthBatchIds.map((id) => [
        id,
        batchHealthSummaries[id]?.state,
      ]),
    ),
    {
      startDate: "",
      endDate: "",
      feedstockTypeIds: [],
      readiness: readinessFilter,
    },
  );
  const feedstockOptions = Array.from(
    new Map(
      allItems
        .filter((batch) => batch.feedstockTypeName)
        .map((batch) => [
          batch.feedstockTypeId,
          {
            id: batch.feedstockTypeId,
            name: batch.feedstockTypeName as string,
          },
        ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Keep preview query chunks stable while operators adjust filters; totals are
  // still calculated from the filtered subset below.
  const { data: co2eStoredPreviews = {}, isLoading: previewsLoading } =
    useCreditBatchCo2eStoredPreviews(allBatchIds);
  const hydratedFilteredItems = filteredItems.map((batch) => {
    const preview = co2eStoredPreviews[batch.id];
    return preview
      ? { ...batch, co2eStoredPreview: preview, previewAvailable: true }
      : batch;
  });

  // Client-side pagination
  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = hydratedFilteredItems.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );

  // Compact list summary — no monetary value, which is registry-owned and not
  // an operational signal on a production cohort.
  const visibleCo2ePreviews = hydratedFilteredItems
    .map((b) => b.co2eStoredPreview)
    .filter((preview): preview is NonNullable<typeof preview> => Boolean(preview));
  const hasPendingCo2e =
    previewsLoading ||
    visibleCo2ePreviews.length < hydratedFilteredItems.length ||
    visibleCo2ePreviews.some((preview) => preview.missingInputs.length > 0);
  const totalCo2e = visibleCo2ePreviews.reduce(
    (sum, preview) => sum + (preview.co2eStoredTonnes ?? 0),
    0
  );

  // Handlers
  const handleCreate = async (data: CreditBatchFormData) => {
    setCreateError(null);
    try {
      const result = await createCreditBatch.mutateAsync(data);
      if (result.success) {
        setSideSheet(null);
        toast.success("Credit batch created successfully");
      } else {
        setCreateError(result.error || "Failed to create credit batch");
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An error occurred while creating the credit batch";
      console.error("Credit batch create error:", err);
      setCreateError(message);
    }
  };

  const handleUpdate = async (data: CreditBatchFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      const { sampling, ...mutableData } = data;
      void sampling;
      const result = await updateCreditBatch.mutateAsync({
        creditBatchId: sideSheet.entity.id,
        ...mutableData,
      });
      if (result.success) {
        setSideSheet(null);
        toast.success("Credit batch updated successfully");
      } else {
        setUpdateError(result.error || "Failed to update credit batch");
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An error occurred while updating the credit batch";
      console.error("Credit batch update error:", err);
      setUpdateError(message);
    }
  };

  const handleDelete = (batchId: string) => setDeletingBatchId(batchId);

  const handleDeleteConfirm = async () => {
    if (!deletingBatchId) return;
    try {
      const result = await deleteCreditBatch.mutateAsync(deletingBatchId);
      if (result.success) {
        toast.success("Credit batch deleted successfully");
      } else {
        toast.error(result.error || "Failed to delete credit batch");
      }
    } catch {
      toast.error("An error occurred while deleting the credit batch");
    }
    setDeletingBatchId(null);
  };

  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  useOpenCreateIntent(openCreate);
  // Opening a batch goes to its detail page (health check + edit), the redesign
  // replacement for the read-only view side-sheet.
  const openView = (batch: CreditBatchWithRelations) => {
    router.push(`/credit-batches/${batch.id}?facility=${batch.facilityId}`);
  };
  const openEdit = (batch: CreditBatchWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: batch, mode: "edit" });
  };
  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };

  const clearFilters = () => {
    setStartDateFilter("");
    setEndDateFilter("");
    setSelectedFeedstockIds([]);
    setReadinessFilter("all");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    startDateFilter ||
      endDateFilter ||
      selectedFeedstockIds.length > 0 ||
      readinessFilter !== "all",
  );

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="verification"
          title="Credit Batches"
          subtitle="Carbon credit batches for verification and registry"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its credit batches." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-max py-32">
        <ServerError
          message={error.message || "Failed to load credit batches"}
        />
      </div>
    );
  }

  if (healthError) {
    return (
      <div className="container-max py-32">
        <ServerError
          message={
            healthError.message ||
            "Failed to load certification readiness for these batches"
          }
        />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Credit Batch" : sideSheetEntity?.code ?? "";

  return (
    <div className="container-max page-shell">
      {/* Header */}
      <PageHeader
        area="verification"
        title="Credit Batches"
        subtitle="Carbon credit batches for verification and registry"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Credit Batch
          </Button>
        }
      />

      {/* Compact operational summary */}
      <div className="flex flex-wrap items-center gap-x-20 gap-y-8 border-y border-[var(--color-border-tertiary)] py-12">
        <span className="inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
          <CertificateIcon size={16} weight="bold" aria-hidden />
          {listLoading
            ? "Loading batches…"
            : `${totalFiltered} ${totalFiltered === 1 ? "batch" : "batches"}`}
        </span>
        <span className="inline-flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
          <LeafIcon size={16} weight="bold" aria-hidden />
          {previewsLoading ? "Calculating CO₂e…" : `${totalCo2e.toFixed(2)} t CO₂e stored`}
        </span>
        {hasPendingCo2e && !previewsLoading && (
          <span className="inline-flex items-center gap-6 body-caption text-[var(--st-wait)]">
            <WarningIcon size={14} weight="fill" aria-hidden />
            Some batches have pending inputs
          </span>
        )}
      </div>

      <CreditBatchFilters
        startDate={startDateFilter}
        endDate={endDateFilter}
        readiness={readinessFilter}
        feedstocks={feedstockOptions}
        selectedFeedstockIds={selectedFeedstockIds}
        hasActiveFilters={hasActiveFilters}
        onStartDateChange={(value) => {
          setStartDateFilter(value);
          setCurrentPage(1);
        }}
        onEndDateChange={(value) => {
          setEndDateFilter(value);
          setCurrentPage(1);
        }}
        onReadinessChange={(value) => {
          setReadinessFilter(value);
          setCurrentPage(1);
        }}
        onAddFeedstock={(id) => {
          setSelectedFeedstockIds((current) => [...current, id]);
          setCurrentPage(1);
        }}
        onRemoveFeedstock={(id) => {
          setSelectedFeedstockIds((current) =>
            current.filter((feedstockId) => feedstockId !== id),
          );
          setCurrentPage(1);
        }}
        onClear={clearFilters}
      />

      {/* Card Grid or Empty State */}
      {listLoading ? (
        <div
          className="bg-[var(--panel-bg)] [border:var(--panel-border)] p-32 body-small text-[var(--color-text-tertiary)]"
          aria-busy="true"
        >
          Loading credit batches…
        </div>
      ) : paginatedItems.length === 0 ? (
        <EmptyState
          padding="lg"
          icon={<CertificateIcon size={48} />}
          title={
            hasActiveFilters
              ? "No credit batches found"
              : "No credit batches yet"
          }
          description={
            hasActiveFilters
              ? "Try adjusting or clearing the filters."
              : "Create your first credit batch to get started."
          }
          action={
            !hasActiveFilters ? (
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={18} weight="bold" />
                New Credit Batch
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-24 xl:grid-cols-2 2xl:grid-cols-3">
            {paginatedItems.map((batch) => (
              <CreditBatchCard
                key={batch.id}
                creditBatch={batch}
                health={batchHealthSummaries[batch.id]}
                onView={openView}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>

          <ListPagination
            page={safeCurrentPage}
            pageCount={totalPages}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
            className="border-t border-[var(--color-border-tertiary)] pt-16 md:px-0"
          />
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingBatchId}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingBatchId(null)}
        title="Delete Credit Batch"
        message="Delete this credit batch? Its applications stay in the system but will be unlinked from this batch, and you can re-link them to another batch later. This can't be undone."
        isPending={deleteCreditBatch.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => {
          if (mode === "view" && sideSheetEntity) {
            setSideSheet(null);
            openView(sideSheetEntity);
            return;
          }
          setSideSheet((previous) =>
            previous ? { ...previous, mode } : null,
          );
        }}
        title={sideSheetTitle}
        editLabel="Edit Credit Batch"
        size="wide"
      >
        {(createError || updateError) && (
          <div className="mb-24">
            <ServerError message={createError || updateError || ""} />
          </div>
        )}
        <CreditBatchForm
          key={sideSheetEntity?.id ?? "create"}
          creditBatch={sideSheetEntity ?? undefined}
          onSubmit={
            sideSheetEntity && sideSheetMode === "edit"
              ? handleUpdate
              : handleCreate
          }
          onClearServerError={() => {
            setCreateError(null);
            setUpdateError(null);
          }}
          onCancel={closeSideSheet}
          isSubmitting={
            createCreditBatch.isPending || updateCreditBatch.isPending
          }
          canManage={canManage}
        />
      </EntitySideSheet>
    </div>
  );
}
