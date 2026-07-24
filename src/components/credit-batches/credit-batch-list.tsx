/**
 * CreditBatchList component
 * Card grid layout with operational filters, pagination, and a derived
 * cross-artifact lifecycle. The dormant credit_batches.status column is not
 * rendered; progress comes from data readiness, Removal submission, and the
 * linked GHG Statement's verifier status.
 *
 * Clicking a card opens the unified side sheet in view mode (deep-linkable via
 * `?batch=<id>`, mirroring the production-run list) — there is no separate
 * detail page; `/credit-batches/[id]` redirects here.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
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
  EmptyState,
  ListPagination,
  PageHeader,
} from "@/components/ui";
import { ServerError } from "@/components/forms";
import { CreditBatchForm } from "./credit-batch-form";
import { CreditBatchCard } from "./credit-batch-card";
import { CreditBatchHealthStrip } from "./credit-batch-health-strip";
import { CreditBatchDurabilityPanel } from "./credit-batch-durability-panel";
import { creditBatchSheetSections } from "./credit-batch-view";
import {
  CreditBatchFilters,
  type CreditBatchReadinessFilter,
} from "./credit-batch-filters";
import {
  filterCreditBatches,
  readinessErrorWithholdsResults,
  readinessErrorMessage,
} from "./credit-batch-filtering";
import {
  useCreditBatches,
  useCreditBatch,
  useCreditBatchCo2eStoredPreviews,
  useCreditBatchProductionRunOptions,
  useCreateCreditBatch,
  useUpdateCreditBatch,
  useDeleteCreditBatch,
} from "@/hooks/use-credit-batches";
import { formatDateRange } from "@/lib/format-utils";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { CREDIT_BATCH_DEEP_LINK_PARAM } from "@/lib/credit-batch-links";
import { useCreditBatchHealthSummaries } from "@/hooks/use-certification";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useListPagination } from "@/hooks/use-list-pagination";
import { SelectFacilityEmptyState } from "@/components/navigation";

// ============================================
// Helpers
// ============================================

const EMPTY_CREDIT_BATCHES: CreditBatchWithRelations[] = [];
export const CREDIT_BATCH_DELETE_MESSAGE =
  "Delete this credit batch? This removes the grouping, releases its production runs so they can be grouped again, and clears direct membership from its lab samples. This can't be undone.";

export function closeCreditBatchCreate(
  clearCreateIntent: () => void,
  closeSideSheet: () => void,
) {
  clearCreateIntent();
  closeSideSheet();
}

// ============================================
// Component
// ============================================

export function CreditBatchList({
  canManage = false,
  initialCreate = false,
}: {
  canManage?: boolean;
  initialCreate?: boolean;
}) {
  // Filter & pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [selectedFeedstockIds, setSelectedFeedstockIds] = useState<string[]>([]);
  const [readinessFilter, setReadinessFilter] =
    useState<CreditBatchReadinessFilter>("all");

  // Side sheet state — `?batch=` deep-links the view sheet (production-run
  // convention); local state handles sheets opened by clicks.
  const [focusedBatchId, setFocusedBatchId] = useQueryState(
    CREDIT_BATCH_DEEP_LINK_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const handledInvalidBatchIdRef = useRef<string | null>(null);
  const [sideSheet, setSideSheet] = useState<{
    entity: CreditBatchWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const createIntent = useOpenCreateIntent({ initialOpen: initialCreate });

  const { facilityId: contextFacilityId } = useFacilityContext();
  const { currentPage, pageSize, setCurrentPage, setPageSize } =
    useListPagination(contextFacilityId);

  // Data fetching — facility-scoped so batches never leak across facilities
  const { data: creditBatches, isLoading: batchesLoading, error } = useCreditBatches(
    contextFacilityId ?? undefined
  );
  const focusedBatch = useCreditBatch(focusedBatchId ?? "");
  const createCreditBatch = useCreateCreditBatch();
  const updateCreditBatch = useUpdateCreditBatch();
  const deleteCreditBatch = useDeleteCreditBatch();
  const toast = useToast();

  // Facility-scoped facets. A credit batch has exactly one feedstock, so the
  // feedstock multi-select is an OR filter across the selected catalogue ids.
  const allItems = creditBatches ?? EMPTY_CREDIT_BATCHES;
  const allBatchIds = allItems.map((batch) => batch.id);
  const facetFilteredItems = filterCreditBatches(allItems, {}, {
    search: searchQuery,
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
  // The sheet's lifecycle rail needs the focused batch's summary even when it
  // is not on the visible page (deep link straight into the sheet).
  const sheetBatchId = sideSheet?.entity?.id ?? focusedBatchId;
  const summaryBatchIds =
    sheetBatchId && !healthBatchIds.includes(sheetBatchId)
      ? [...healthBatchIds, sheetBatchId]
      : healthBatchIds;
  const {
    data: batchHealthSummaries = {},
    isLoading: healthLoading,
    isFetching: healthFetching,
    error: healthError,
    refetch: refetchHealth,
  } =
    useCreditBatchHealthSummaries(
      contextFacilityId ?? undefined,
      summaryBatchIds,
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
      search: "",
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
  const {
    data: co2eStoredPreviews = {},
    isLoading: previewsLoading,
    isFetching: previewsFetching,
    error: previewsError,
    refetch: refetchPreviews,
  } = useCreditBatchCo2eStoredPreviews(allBatchIds);
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
    !previewsError &&
    (previewsLoading ||
      visibleCo2ePreviews.length < hydratedFilteredItems.length ||
      visibleCo2ePreviews.some((preview) => preview.missingInputs.length > 0));
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
        closeCreditBatchCreate(createIntent.clear, () => setSideSheet(null));
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
        if (focusedBatchId === deletingBatchId) {
          void setFocusedBatchId(null);
          setSideSheet(null);
        }
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
    createIntent.clear();
    void setFocusedBatchId(null);
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (batch: CreditBatchWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    void setFocusedBatchId(batch.id);
    setSideSheet({ entity: batch, mode: "view" });
  };
  const openEdit = (batch: CreditBatchWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: batch, mode: "edit" });
  };
  const closeSideSheet = () => {
    createIntent.clear();
    void setFocusedBatchId(null);
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };

  // Clear a deep-linked `?batch=` that cannot be opened (wrong facility,
  // deleted, or cross-org) — same guard as the production-run list.
  useEffect(() => {
    if (!focusedBatchId) {
      handledInvalidBatchIdRef.current = null;
      return;
    }
    if (
      focusedBatch.isLoading ||
      focusedBatch.isFetching ||
      focusedBatch.isPending
    ) {
      return;
    }
    if (handledInvalidBatchIdRef.current === focusedBatchId) return;

    if (
      focusedBatch.data &&
      contextFacilityId &&
      focusedBatch.data.facilityId !== contextFacilityId
    ) {
      handledInvalidBatchIdRef.current = focusedBatchId;
      toast.error("Linked credit batch is not in the selected facility");
      void setFocusedBatchId(null);
      return;
    }

    if (
      focusedBatch.isError ||
      (focusedBatch.isSuccess && !focusedBatch.data)
    ) {
      handledInvalidBatchIdRef.current = focusedBatchId;
      toast.error("Linked credit batch could not be opened");
      void setFocusedBatchId(null);
    }
  }, [
    contextFacilityId,
    focusedBatch.data,
    focusedBatch.isError,
    focusedBatch.isFetching,
    focusedBatch.isLoading,
    focusedBatch.isPending,
    focusedBatch.isSuccess,
    focusedBatchId,
    setFocusedBatchId,
    toast,
  ]);

  const deepLinkedSideSheet =
    focusedBatchId &&
    focusedBatch.data &&
    (!contextFacilityId || focusedBatch.data.facilityId === contextFacilityId)
      ? ({ entity: focusedBatch.data, mode: "view" } as const)
      : null;
  const displaySideSheet = sideSheet ?? deepLinkedSideSheet;

  // Member production runs for the view sheet's "Production runs" section.
  const viewEntity = displaySideSheet?.entity ?? null;
  const runOptionsQuery = useCreditBatchProductionRunOptions({
    facilityId: viewEntity?.facilityId,
    startDate: viewEntity?.startDate,
    endDate: viewEntity?.endDate,
    includeCreditBatchId: viewEntity?.id,
  });
  const memberRunIds = new Set(viewEntity?.productionRunIds ?? []);
  const memberRuns = (runOptionsQuery.data ?? []).filter((run) =>
    memberRunIds.has(run.id),
  );
  const displayedRuns = (runOptionsQuery.data ?? []).filter((run) => {
    if (memberRunIds.has(run.id)) return true;
    return (
      viewEntity != null &&
      run.status !== COMPLETED_PRODUCTION_RUN_STATUS &&
      run.feedstockTypeIds.length === 1 &&
      run.feedstockTypeIds[0] === viewEntity.feedstockTypeId
    );
  });

  const handleModeChange = (mode: SideSheetMode) => {
    if (!displaySideSheet?.entity) return;
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: displaySideSheet.entity, mode });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStartDateFilter("");
    setEndDateFilter("");
    setSelectedFeedstockIds([]);
    setReadinessFilter("all");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    searchQuery ||
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

  const readinessResultsUnavailable = readinessErrorWithholdsResults(
    readinessFilter,
    healthError,
  );

  // Derived values for the side sheet
  const sideSheetOpen = !!displaySideSheet || createIntent.isOpen;
  const sideSheetMode = displaySideSheet?.mode ?? "create";
  const sideSheetEntity = displaySideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Credit Batch" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" || !sideSheetEntity
      ? undefined
      : formatDateRange(sideSheetEntity.startDate, sideSheetEntity.endDate);

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
            : readinessResultsUnavailable
              ? "Readiness unavailable"
              : `${totalFiltered} ${totalFiltered === 1 ? "batch" : "batches"}`}
        </span>
        {previewsError ? (
          <span
            className="inline-flex items-center gap-8 body-small text-[var(--st-wait)]"
            role="alert"
          >
            <WarningIcon size={14} weight="fill" aria-hidden />
            CO₂e unavailable
            <Button
              variant="weak"
              size="small"
              busy={previewsFetching}
              onClick={() => void refetchPreviews()}
            >
              Retry
            </Button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
            <LeafIcon size={16} weight="bold" aria-hidden />
            {previewsLoading
              ? "Calculating CO₂e…"
              : `${totalCo2e.toFixed(2)} t CO₂e stored`}
          </span>
        )}
        {hasPendingCo2e && !previewsLoading && (
          <span className="inline-flex items-center gap-6 body-caption text-[var(--st-wait)]">
            <WarningIcon size={14} weight="fill" aria-hidden />
            Some batches need CO₂e inputs
          </span>
        )}
      </div>

      <CreditBatchFilters
        search={searchQuery}
        startDate={startDateFilter}
        endDate={endDateFilter}
        readiness={readinessFilter}
        feedstocks={feedstockOptions}
        selectedFeedstockIds={selectedFeedstockIds}
        hasActiveFilters={hasActiveFilters}
        onSearchChange={(value) => {
          setSearchQuery(value);
          setCurrentPage(1);
        }}
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

      {healthError && (
        <div
          className="flex flex-col gap-12 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-16 py-12 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span className="inline-flex items-center gap-8 body-small text-[var(--color-text-secondary)]">
            <WarningIcon
              size={16}
              weight="fill"
              className="shrink-0 text-[var(--st-wait)]"
              aria-hidden
            />
            {readinessErrorMessage(readinessFilter)}
          </span>
          <Button
            variant="weak"
            size="small"
            busy={healthFetching}
            onClick={() => void refetchHealth()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Card Grid or Empty State */}
      {readinessResultsUnavailable ? null : listLoading ? (
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
                health={healthError ? undefined : batchHealthSummaries[batch.id]}
                isHealthLoading={healthLoading && !healthError}
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
            onPageSizeChange={setPageSize}
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
        message={CREDIT_BATCH_DELETE_MESSAGE}
        isPending={deleteCreditBatch.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={handleModeChange}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Credit Batch"
        size="wide"
        sections={
          sideSheetEntity
            ? creditBatchSheetSections({
                creditBatch: sideSheetEntity,
                productionRuns: displayedRuns,
                isLoadingRuns: runOptionsQuery.isLoading,
                runsError: runOptionsQuery.error,
                isRetryingRuns: runOptionsQuery.isFetching,
                onRetryRuns: () => void runOptionsQuery.refetch(),
                healthSummary: healthError
                  ? undefined
                  : batchHealthSummaries[sideSheetEntity.id],
                isHealthLoading: healthLoading && !healthError,
              })
            : undefined
        }
        viewModeChildren={
          sideSheetEntity ? (
            <>
              <CreditBatchHealthStrip
                creditBatchId={sideSheetEntity.id}
                facilityId={sideSheetEntity.facilityId}
                productionRuns={memberRuns}
                feedstockName={sideSheetEntity.feedstockTypeName}
              />
              <CreditBatchDurabilityPanel
                creditBatchId={sideSheetEntity.id}
                facilityId={sideSheetEntity.facilityId}
              />
            </>
          ) : undefined
        }
      >
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
          errorMessage={createError || updateError || undefined}
          canManage={canManage}
        />
      </EntitySideSheet>
    </div>
  );
}
