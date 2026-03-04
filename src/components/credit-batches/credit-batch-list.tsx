/**
 * CreditBatchList component
 * Displays credit batch records in a DataTable with create/edit/delete
 * Includes stat cards, search, pagination, and status badges
 */
"use client";

import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { format, isValid, parseISO } from "date-fns";
import { Certificate, Plus, Leaf, CurrencyCircleDollar } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { CreditBatchForm } from "./credit-batch-form";
import {
  useCreditBatches,
  useCreateCreditBatch,
  useUpdateCreditBatch,
  useDeleteCreditBatch,
} from "@/hooks/use-credit-batches";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import {
  formatCreditBatchStatus,
  formatDurabilityOption,
  getStatusColor,
  type CreditBatchStatus,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";

// ============================================
// Helpers
// ============================================

function formatSafeDate(dateStr: string | Date): string {
  const date = typeof dateStr === "string" ? parseISO(dateStr) : dateStr;
  return isValid(date) ? format(date, "MMM d, yyyy") : "—";
}

// ============================================
// Status Cell
// ============================================

function CreditStatusBadge({ status }: { status: CreditBatchStatus }) {
  const colors = getStatusColor(status);
  return (
    <span className={`px-8 py-4 text-[var(--text-xs)] font-medium ${colors.bg} ${colors.text}`}>
      {formatCreditBatchStatus(status)}
    </span>
  );
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (batch: CreditBatchWithRelations) => void,
  onDelete: (batchId: string) => void,
): ColumnDef<CreditBatchWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "facilityName",
      header: "Facility",
      accessorFn: (row) => row.facility?.name ?? "",
      cell: ({ row }) => (
        <span>{row.original.facility?.name ?? "—"}</span>
      ),
    },
    {
      id: "period",
      header: "Crediting Period",
      cell: ({ row }) => (
        <span>
          {formatSafeDate(row.original.startDate)} — {formatSafeDate(row.original.endDate)}
        </span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "durabilityOption",
      header: "Durability",
      cell: ({ row }) => (
        <span>{formatDurabilityOption(row.original.durabilityOption as DurabilityOption)}</span>
      ),
    },
    {
      accessorKey: "weightTons",
      header: "Weight",
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.weightTons?.toFixed(2) ?? "—"} t
        </span>
      ),
    },
    {
      accessorKey: "totalCo2eStoredTons",
      header: "CO2e Stored",
      cell: ({ row }) => {
        const val = row.original.totalCo2eStoredTons;
        return (
          <span className={val != null ? "font-mono text-[var(--color-signal-green)]" : ""}>
            {val != null ? `${val.toFixed(2)} t` : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <CreditStatusBadge status={row.original.status as CreditBatchStatus} />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-16">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(row.original);
            }}
            className="h-[32px] px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.original.id);
            }}
            className="h-[32px] px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small"
          >
            Delete
          </button>
        </div>
      ),
      enableSorting: false,
    },
  ];
}

// ============================================
// Component
// ============================================

interface CreditBatchListProps {
  facilities?: { id: string; name: string }[];
  applications?: { id: string; code: string }[];
}

export function CreditBatchList({
  facilities = [],
  applications = [],
}: CreditBatchListProps) {
  // Side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: CreditBatchWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Data fetching
  const { data: creditBatches, isLoading, error } = useCreditBatches();
  const createCreditBatch = useCreateCreditBatch();
  const updateCreditBatch = useUpdateCreditBatch();
  const deleteCreditBatch = useDeleteCreditBatch();
  const toast = useToast();

  const facilityOptions = facilities.map((f) => ({ id: f.id, name: f.name }));
  const applicationOptions = applications.map((a) => ({ id: a.id, code: a.code }));

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
      const message = err instanceof Error ? err.message : "An error occurred while creating the credit batch";
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
      const message = err instanceof Error ? err.message : "An error occurred while updating the credit batch";
      console.error("Credit batch update error:", err);
      setUpdateError(message);
    }
  };

  const handleDelete = (batchId: string) => {
    setDeletingBatchId(batchId);
  };

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

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (batch: CreditBatchWithRelations) => { setSideSheet({ entity: batch, mode: "view" }); };
  const openEdit = (batch: CreditBatchWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: batch, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };

  // Memoize columns
  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  const items = (creditBatches ?? []) as CreditBatchWithRelations[];
  const totalBatches = items.length;
  const totalCo2e = items.reduce((sum, b) => sum + (b.totalCo2eStoredTons ?? 0), 0);
  const totalValue = items.reduce((sum, b) => sum + (b.value ?? 0), 0);

  if (error) {
    return (
      <div className="container-max py-32">
        <ServerError message={error.message || "Failed to load credit batches"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div>
          <h1 className="title-heading-2">Credit Batches</h1>
          <p className="body-small text-[var(--color-text-secondary)] mt-1">
            Carbon credit batches for verification and registry
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={18} weight="bold" />
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
          value={`${totalCo2e.toFixed(2)} t`}
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

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={items}
        enableSorting
        enableFiltering
        enablePagination
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Certificate size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No credit batches yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first credit batch to get started
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={18} weight="bold" />
              New Credit Batch
            </Button>
          </div>
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search credit batches..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

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
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Credit Batch" : sideSheet.entity?.code ?? ""}
          subtitle={
            sideSheet.mode === "create"
              ? undefined
              : sideSheet.entity?.facility?.name
          }
          editLabel="Edit Credit Batch"
          size="wide"
          sections={sideSheet.entity ? [
            {
              title: "General",
              fields: [
                { label: "Code", value: sideSheet.entity.code },
                {
                  label: "Status",
                  value: (
                    <CreditStatusBadge
                      status={sideSheet.entity.status as CreditBatchStatus}
                    />
                  ),
                },
              ],
            },
            {
              title: "Details",
              fields: [
                { label: "Facility", value: sideSheet.entity.facility?.name },
                {
                  label: "Crediting Period",
                  value: `${formatSafeDate(sideSheet.entity.startDate)} — ${formatSafeDate(sideSheet.entity.endDate)}`,
                },
                {
                  label: "Durability Option",
                  value: sideSheet.entity.durabilityOption
                    ? formatDurabilityOption(sideSheet.entity.durabilityOption as DurabilityOption)
                    : null,
                },
              ],
            },
            {
              title: "Metrics",
              fields: [
                {
                  label: "Total Biochar Weight",
                  value: sideSheet.entity.weightTons != null
                    ? `${sideSheet.entity.weightTons.toFixed(2)} t`
                    : null,
                },
                {
                  label: "Total CO2e Stored",
                  value: sideSheet.entity.totalCo2eStoredTons != null
                    ? `${sideSheet.entity.totalCo2eStoredTons.toFixed(2)} t CO\u2082e`
                    : null,
                },
              ],
            },
            {
              title: "Applications",
              fields: [
                {
                  label: "Application Count",
                  value: String(sideSheet.entity.applicationCount ?? 0),
                },
              ],
            },
          ] : undefined}
        >
          {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
          <CreditBatchForm
            key={sideSheet.entity?.id ?? "create"}
            creditBatch={sideSheet.entity ?? undefined}
            facilities={facilityOptions}
            applications={applicationOptions}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createCreditBatch.isPending || updateCreditBatch.isPending}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
