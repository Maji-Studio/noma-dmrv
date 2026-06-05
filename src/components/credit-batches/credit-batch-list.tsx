/**
 * CreditBatchList component
 * Card grid layout with search, status filter, and pagination
 */
"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatSafeDate, getPaginationLabel } from "@/lib/format-utils";
import {
  Certificate,
  CurrencyCircleDollar,
  Leaf,
  MagnifyingGlass,
  Plus,
  X,
} from "@phosphor-icons/react";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import {
  CreditBatchForm,
  type ApplicationOption,
} from "./credit-batch-form";
import { CreditBatchCard } from "./credit-batch-card";
import { CertifyPanel } from "@/components/certification";
import {
  useCreditBatches,
  useCreateCreditBatch,
  useUpdateCreditBatch,
  useDeleteCreditBatch,
} from "@/hooks/use-credit-batches";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import {
  creditBatchStatuses,
  formatCertifierProvider,
  formatCreditBatchStatus,
  formatDurabilityOption,
  getStatusColor,
  type CertifierProvider,
  type CreditBatchStatus,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";

// ============================================
// Helpers
// ============================================

const EMPTY_CREDIT_BATCHES: CreditBatchWithRelations[] = [];

function CreditStatusBadge({ status }: { status: CreditBatchStatus }) {
  const colors = getStatusColor(status);
  return (
    <span
      className={`px-8 py-4 text-[var(--text-xs)] font-medium ${colors.bg} ${colors.text}`}
    >
      {formatCreditBatchStatus(status)}
    </span>
  );
}


// ============================================
// Component
// ============================================

interface CreditBatchListProps {
  applications?: ApplicationOption[];
}

export function CreditBatchList({
  applications = [],
}: CreditBatchListProps) {
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

  // Data fetching
  const { data: creditBatches, isLoading, error } = useCreditBatches();
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

  // Stats (from all items, not filtered)
  const totalBatches = allItems.length;
  const hasPendingCo2e = allItems.some(
    (b) => b.co2eStoredPreview.missingInputs.length > 0
  );
  const totalCo2e = allItems.reduce(
    (sum, b) => sum + (b.co2eStoredPreview.co2eStoredTonnes ?? 0),
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

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div className="flex flex-col gap-4">
          <h1 className="title-heading-2">Credit Batches</h1>
          <p className="body-small text-[var(--color-text-secondary)]">
            Carbon credit batches for verification and registry
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={20} weight="bold" />
          New Credit Batch
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Batches"
          value={totalBatches}
          icon={<Certificate size={24} weight="bold" />}
          description="Carbon credit batches"
          isLoading={isLoading}
        />
        <StatCard
          title="CO2e Stored"
          value={hasPendingCo2e ? "Pending" : `${totalCo2e.toFixed(2)} t`}
          icon={<Leaf size={24} weight="bold" />}
          description="Total carbon stored"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Value"
          value={totalValue.toLocaleString()}
          icon={<CurrencyCircleDollar size={24} weight="bold" />}
          description="Combined batch value"
          isLoading={isLoading}
        />
      </div>

      {/* Filter Bar */}
      <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="flex flex-col gap-16 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-12 md:grid-cols-[minmax(0,1fr)_200px]">
            <div className="relative">
              <MagnifyingGlass
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
                <X size={16} weight="bold" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Card Grid or Empty State */}
      {paginatedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-24 border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-white)] py-56">
          <Certificate
            size={48}
            className="text-[var(--color-text-tertiary)]"
          />
          <div className="text-center">
            <h3 className="title-heading-3 mb-8">
              {hasActiveFilters
                ? "No credit batches found"
                : "No credit batches yet"}
            </h3>
            <p className="body-small text-[var(--color-text-secondary)]">
              {hasActiveFilters
                ? "Try adjusting your search or filters."
                : "Create your first credit batch to get started."}
            </p>
          </div>
          {!hasActiveFilters && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={18} weight="bold" />
              New Credit Batch
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-24 xl:grid-cols-2 2xl:grid-cols-3">
            {paginatedItems.map((batch) => (
              <CreditBatchCard
                key={batch.id}
                creditBatch={batch}
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
        message="Are you sure you want to delete this credit batch? This action cannot be undone and will remove all associated application links."
        isPending={deleteCreditBatch.isPending}
      />

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) =>
            setSideSheet((prev) => (prev ? { ...prev, mode } : null))
          }
          title={
            sideSheet.mode === "create"
              ? "Create Credit Batch"
              : sideSheet.entity?.code ?? ""
          }
          subtitle={
            sideSheet.mode === "create"
              ? undefined
              : sideSheet.entity?.facility?.name
          }
          editLabel="Edit Credit Batch"
          size="wide"
          sections={
            sideSheet.entity
              ? [
                  {
                    title: "General",
                    fields: [
                      { label: "Code", value: sideSheet.entity.code },
                      {
                        label: "Status",
                        value: (
                          <CreditStatusBadge
                            status={
                              sideSheet.entity.status as CreditBatchStatus
                            }
                          />
                        ),
                      },
                      {
                        label: "Certifier",
                        value: sideSheet.entity.certifier
                          ? formatCertifierProvider(
                              sideSheet.entity.certifier as CertifierProvider
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
                        value: sideSheet.entity.facility?.name,
                      },
                      {
                        label: "Crediting Period",
                        value: `${formatSafeDate(sideSheet.entity.startDate)} — ${formatSafeDate(sideSheet.entity.endDate)}`,
                      },
                      {
                        label: "Durability Option",
                        value: sideSheet.entity.durabilityOption
                          ? formatDurabilityOption(
                              sideSheet.entity
                                .durabilityOption as DurabilityOption
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
                          sideSheet.entity.weightTons != null
                            ? `${sideSheet.entity.weightTons.toFixed(2)} t`
                            : null,
                      },
                      {
                        label: "Total CO2e Stored",
                        value:
                          sideSheet.entity.co2eStoredPreview.co2eStoredTonnes != null
                            ? `${sideSheet.entity.co2eStoredPreview.co2eStoredTonnes.toFixed(2)} t CO\u2082e`
                            : "Pending inputs",
                      },
                      {
                        label: "Preview Inputs",
                        value:
                          sideSheet.entity.co2eStoredPreview.missingInputs.length > 0
                            ? sideSheet.entity.co2eStoredPreview.missingInputs.join(", ")
                            : "Complete",
                      },
                    ],
                  },
                  {
                    title: "Applications",
                    fields: [
                      {
                        label: "Application Count",
                        value: String(
                          sideSheet.entity.applicationCount ?? 0
                        ),
                      },
                    ],
                  },
                ]
              : undefined
          }
          viewModeChildren={
            sideSheet.entity && sideSheet.mode === "view" ? (
              <CertifyPanel creditBatchId={sideSheet.entity.id} />
            ) : null
          }
        >
          {(createError || updateError) && (
            <div className="mb-24">
              <ServerError message={createError || updateError || ""} />
            </div>
          )}
          <CreditBatchForm
            key={sideSheet.entity?.id ?? "create"}
            creditBatch={sideSheet.entity ?? undefined}
            applications={applications}
            existingBatches={allItems.map((b) => ({
              id: b.id,
              code: b.code,
              facilityId: b.facilityId,
              startDate: typeof b.startDate === "string" ? b.startDate : b.startDate,
              endDate: typeof b.endDate === "string" ? b.endDate : b.endDate,
            }))}
            onSubmit={
              sideSheet.entity && sideSheet.mode === "edit"
                ? handleUpdate
                : handleCreate
            }
            onCancel={closeSideSheet}
            isSubmitting={
              createCreditBatch.isPending || updateCreditBatch.isPending
            }
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
