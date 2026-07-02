/**
 * CreditBatchList component
 * Card grid layout with search, status filter, and pagination
 */
"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatSafeDate, getPaginationLabel } from "@/lib/format-utils";
import {
  CertificateIcon,
  CurrencyCircleDollarIcon,
  LeafIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import { CreditBatchForm } from "./credit-batch-form";
import { CreditBatchCard } from "./credit-batch-card";
import { CertifyPanel } from "@/components/certification";
import {
  useCreditBatches,
  useCreditBatchCo2eStoredPreviews,
  useCreateCreditBatch,
  useUpdateCreditBatch,
  useDeleteCreditBatch,
} from "@/hooks/use-credit-batches";
import { useCreditBatchHealthSummaries } from "@/hooks/use-certification";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import {
  creditBatchStatuses,
  formatCertifierProvider,
  formatCreditBatchStatus,
  formatDurabilityOption,
  type CertifierProvider,
  type CreditBatchStatus,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useFacilityContext } from "@/hooks/use-facility-context";

// ============================================
// Helpers
// ============================================

const EMPTY_CREDIT_BATCHES: CreditBatchWithRelations[] = [];

// ============================================
// Component
// ============================================

export function CreditBatchList() {
  // Filter & pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

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
  const { data: creditBatches, isLoading, error } = useCreditBatches(
    contextFacilityId ?? undefined
  );
  const createCreditBatch = useCreateCreditBatch();
  const updateCreditBatch = useUpdateCreditBatch();
  const deleteCreditBatch = useDeleteCreditBatch();
  const toast = useToast();

  // Client-side filtering
  const allItems = creditBatches ?? EMPTY_CREDIT_BATCHES;
  const filteredItems = useMemo(() => {
    let items = allItems;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (b) =>
          b.code.toLowerCase().includes(q) ||
          (b.facility?.name ?? "").toLowerCase().includes(q)
      );
    }

    if (statusFilter) {
      items = items.filter((b) => b.status === statusFilter);
    }

    return items;
  }, [allItems, searchQuery, statusFilter]);

  // Client-side pagination
  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedItems = filteredItems.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );
  const previewIds = paginatedItems.map((b) => b.id);
  const {
    data: co2eStoredPreviews = {},
    isLoading: previewsLoading,
  } = useCreditBatchCo2eStoredPreviews(previewIds);
  // Per-batch certification readiness for the visible page, so each card can
  // surface a cert tag (incl. missing application evidence) that links into the
  // detail page's submission gate. Same classifier, never disagrees.
  const { data: batchHealthSummaries = {} } = useCreditBatchHealthSummaries(
    contextFacilityId ?? undefined,
    previewIds,
  );
  const hydratedPaginatedItems = paginatedItems.map((batch) => {
    const preview = co2eStoredPreviews[batch.id];
    return preview
      ? { ...batch, co2eStoredPreview: preview, previewAvailable: true }
      : batch;
  });

  // Stats (from all items, not filtered)
  const totalBatches = allItems.length;
  const visibleCo2ePreviews = hydratedPaginatedItems
    .map((b) => b.co2eStoredPreview)
    .filter((preview): preview is NonNullable<typeof preview> => Boolean(preview));
  const hasPendingCo2e =
    previewsLoading ||
    visibleCo2ePreviews.length < hydratedPaginatedItems.length ||
    visibleCo2ePreviews.some((preview) => preview.missingInputs.length > 0);
  const totalCo2e = visibleCo2ePreviews.reduce(
    (sum, preview) => sum + (preview.co2eStoredTonnes ?? 0),
    0
  );
  const totalValue = allItems.reduce((sum, b) => sum + (b.value ?? 0), 0);

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
      const result = await updateCreditBatch.mutateAsync({
        creditBatchId: sideSheet.entity.id,
        ...data,
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
    setSearchQuery("");
    setStatusFilter("");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(searchQuery || statusFilter);

  if (error) {
    return (
      <div className="container-max py-32">
        <ServerError
          message={error.message || "Failed to load credit batches"}
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

  const sideSheetSubtitle =
    sideSheetMode === "create" ? undefined : sideSheetEntity?.facility?.name;

  const sideSheetSections = sideSheetEntity
    ? [
        {
          title: "General",
          fields: [
            { label: "Code", value: sideSheetEntity.code },
            {
              label: "Status",
              value: (
                <StatusBadge
                  status={sideSheetEntity.status as CreditBatchStatus}
                />
              ),
            },
            {
              label: "Certification",
              value: sideSheetEntity.certifier
                ? formatCertifierProvider(
                    sideSheetEntity.certifier as CertifierProvider
                  )
                : null,
            },
          ],
        },
        {
          title: "Details",
          fields: [
            {
              label: "Facility",
              value: sideSheetEntity.facility?.name,
            },
            {
              label: "Crediting Period",
              value: `${formatSafeDate(sideSheetEntity.startDate)} — ${formatSafeDate(sideSheetEntity.endDate)}`,
            },
            {
              label: "Durability Option",
              value: sideSheetEntity.durabilityOption
                ? formatDurabilityOption(
                    sideSheetEntity.durabilityOption as DurabilityOption
                  )
                : null,
            },
          ],
        },
        {
          title: "Metrics",
          fields: [
            {
              label: "Total Biochar Weight",
              value:
                sideSheetEntity.weightTons != null
                  ? `${sideSheetEntity.weightTons.toFixed(2)} t`
                  : null,
            },
            {
              label: "Total CO₂e stored",
              value:
                sideSheetEntity.co2eStoredPreview?.co2eStoredTonnes != null
                  ? `${sideSheetEntity.co2eStoredPreview.co2eStoredTonnes.toFixed(2)} t CO₂e`
                  : sideSheetEntity.co2eStoredPreview
                    ? "Pending inputs"
                    : "Open the batch detail to calculate",
            },
            {
              label: "Preview Inputs",
              value:
                !sideSheetEntity.co2eStoredPreview
                  ? "Open the batch detail to calculate"
                  : sideSheetEntity.co2eStoredPreview.missingInputs.length > 0
                    ? sideSheetEntity.co2eStoredPreview.missingInputs.join(", ")
                    : "Complete",
            },
          ],
        },
        {
          title: "Applications",
          fields: [
            {
              label: "Application Count",
              value: String(sideSheetEntity.applicationCount ?? 0),
            },
          ],
        },
      ]
    : undefined;

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

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Batches"
          value={totalBatches}
          icon={<CertificateIcon size={24} weight="bold" />}
          description="Carbon credit batches"
          isLoading={isLoading}
        />
        <StatCard
          title="CO₂e stored"
          value={hasPendingCo2e ? "Pending" : `${totalCo2e.toFixed(2)} t`}
          icon={<LeafIcon size={24} weight="bold" />}
          description="Current page carbon stored"
          isLoading={isLoading || previewsLoading}
        />
        <StatCard
          title="Total Value"
          value={totalValue.toLocaleString()}
          icon={<CurrencyCircleDollarIcon size={24} weight="bold" />}
          description="Combined batch value"
          isLoading={isLoading}
        />
      </div>

      {/* Filter Bar */}
      <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="flex flex-col gap-16 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-12 md:grid-cols-[minmax(0,1fr)_200px]">
            <div className="relative">
              <MagnifyingGlassIcon
                size={18}
                className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                type="text"
                placeholder="Search by code or facility..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                aria-label="Search credit batches"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
            >
              <option value="">All Statuses</option>
              {creditBatchStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatCreditBatchStatus(status)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-8">
            <select
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
              aria-label="Credit batches per page"
            >
              <option value="12">12 per page</option>
              <option value="24">24 per page</option>
              <option value="36">36 per page</option>
            </select>

            {hasActiveFilters && (
              <Button variant="noOutline" size="small" onClick={clearFilters}>
                <XIcon size={16} weight="bold" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Card Grid or Empty State */}
      {paginatedItems.length === 0 ? (
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
              ? "Try adjusting your search or filters."
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
            {hydratedPaginatedItems.map((batch) => (
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

          {/* Pagination */}
          <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-16 md:flex-row md:items-center md:justify-between">
            <p className="body-small text-[var(--color-text-secondary)]">
              {getPaginationLabel(safeCurrentPage, pageSize, totalFiltered, "credit batches")}
            </p>

            <div className="flex items-center gap-8">
              <Button
                variant="default"
                size="small"
                disabled={safeCurrentPage <= 1}
                onClick={() =>
                  setCurrentPage((page) => Math.max(1, page - 1))
                }
              >
                Previous
              </Button>
              <span className="px-8 body-small text-[var(--color-text-secondary)]">
                Page {safeCurrentPage} of {totalPages}
              </span>
              <Button
                variant="default"
                size="small"
                disabled={safeCurrentPage >= totalPages}
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
              >
                Next
              </Button>
            </div>
          </div>
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
        onModeChange={(mode) =>
          setSideSheet((prev) => (prev ? { ...prev, mode } : null))
        }
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Credit Batch"
        size="wide"
        sections={sideSheetSections}
        viewModeChildren={
          sideSheetEntity && sideSheetMode === "view" ? (
            <CertifyPanel creditBatchId={sideSheetEntity.id} />
          ) : null
        }
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
        />
      </EntitySideSheet>
    </div>
  );
}
