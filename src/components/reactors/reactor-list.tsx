/**
 * ReactorList component
 * Main reactor listing with CRUD operations using DataTable
 * Includes stat cards, Method B eligibility, and unified EntitySideSheet
 */
"use client";

import { useState, useMemo } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import type { ColumnDef } from "@tanstack/react-table";
import { Lightning, Flask, Plus, CheckCircle, Warning } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/dashboard/stat-card";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { ReactorForm } from "./reactor-form";
import {
  useCreateReactor,
  useDeleteReactor,
  useReactors,
  useUpdateReactor,
} from "@/hooks/use-reactors";
import {
  formatReactorType,
  formatSamplingMethod,
  type ReactorFormData,
  type SamplingMethod,
} from "@/schemas/reactors";
import type { ReactorWithRelations } from "@/data-access/reactors";
import type { Reactor } from "@/db/schema";

// ============================================
// Method B Eligibility Badge
// ============================================

function MethodBEligibilityBadge({
  isEligible,
  sampleCount,
  minimumRequired,
}: {
  isEligible: boolean;
  sampleCount: number;
  minimumRequired: number;
}) {
  if (isEligible) {
    return (
      <div className="inline-flex items-center gap-4 px-8 py-4 bg-[var(--color-signal-green)]/10 border border-[var(--color-signal-green)]/30">
        <CheckCircle size={14} weight="fill" className="text-[var(--color-signal-green)]" />
        <span className="text-[var(--text-xs)] font-medium text-[var(--color-signal-green)]">
          Eligible ({sampleCount})
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-4 px-8 py-4 bg-[var(--color-signal-yellow)]/10 border border-[var(--color-signal-yellow)]/30">
      <Warning size={14} weight="fill" className="text-[var(--color-signal-yellow)]" />
      <span className="text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)]">
        {sampleCount}/{minimumRequired}
      </span>
    </div>
  );
}

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (reactor: ReactorWithRelations) => void,
  onDelete: (reactorId: string) => void,
): ColumnDef<ReactorWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "identifier",
      header: "Identifier",
      cell: ({ row }) => <span>{row.original.identifier}</span>,
    },
    {
      accessorKey: "facilityName",
      header: "Facility",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.facilityName || "—"}</span>
          {row.original.facilityCode && (
            <span className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
              {row.original.facilityCode}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "reactorType",
      header: "Type",
      cell: ({ row }) => <span>{formatReactorType(row.original.reactorType)}</span>,
    },
    {
      accessorKey: "samplingMethod",
      header: "Sampling",
      cell: ({ row }) => (
        <span className={row.original.samplingMethod === "method_b" ? "text-[var(--color-signal-green)]" : ""}>
          {formatSamplingMethod(row.original.samplingMethod as SamplingMethod)}
        </span>
      ),
    },
    {
      id: "methodBStatus",
      header: "Method B Status",
      cell: ({ row }) => (
        <MethodBEligibilityBadge
          isEligible={row.original.methodBEligibility?.isEligible ?? false}
          sampleCount={row.original.methodBEligibility?.priorMethodASampleCount ?? 0}
          minimumRequired={row.original.methodBEligibility?.minimumMethodASampleCount ?? 30}
        />
      ),
      enableSorting: false,
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

export function ReactorList() {
  // Unified side sheet state
  const [sideSheet, setSideSheet] = useState<{
    entity: ReactorWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingReactorId, setDeletingReactorId] = useState<string | null>(null);

  // Error state
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Server-side search: debounce the search input before querying
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 250);
  const filters = debouncedSearch ? { search: debouncedSearch, pageSize: 100 } : { pageSize: 100 };

  // Data fetching — pass search filter so the server does the filtering
  const { data: reactorsData, isLoading, error: fetchError } = useReactors(filters);
  const createReactor = useCreateReactor();
  const updateReactor = useUpdateReactor();
  const deleteReactor = useDeleteReactor();
  const toast = useToast();

  // Side sheet helpers
  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };
  const openView = (reactor: ReactorWithRelations) => {
    setSideSheet({ entity: reactor, mode: "view" });
  };
  const openEdit = (reactor: ReactorWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: reactor, mode: "edit" });
  };
  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };
  useOpenCreateIntent(openCreate);

  // Handlers
  const handleCreate = async (data: ReactorFormData) => {
    setCreateError(null);
    try {
      await createReactor.mutateAsync(data);
      setSideSheet(null);
      toast.success("Reactor created successfully");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create reactor");
    }
  };

  const handleUpdate = async (data: ReactorFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateReactor.mutateAsync({ reactorId: sideSheet.entity.id, ...data });
      setSideSheet(null);
      toast.success("Reactor updated successfully");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update reactor");
    }
  };

  const handleDelete = (reactorId: string) => {
    setDeletingReactorId(reactorId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingReactorId) return;
    setDeleteError(null);
    try {
      await deleteReactor.mutateAsync(deletingReactorId);
      setDeletingReactorId(null);
      toast.success("Reactor deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete reactor");
    }
  };

  // Memoize columns
  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  const reactors = reactorsData?.items ?? [];
  const totalReactors = reactorsData?.total ?? 0;
  const methodBEligibleCount = reactors.filter((r) => r.methodBEligibility?.isEligible).length;
  const totalThroughput = reactors.reduce((sum, r) => sum + (r.capacityKg || 0), 0);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load reactors"} />
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Header */}
      <div className="flex items-center justify-between gap-24">
        <div>
          <h1 className="title-heading-2">Reactors</h1>
          <p className="body-small text-[var(--color-text-secondary)] mt-1">
            Pyrolysis equipment and sampling configuration
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={18} weight="bold" />
          New Reactor
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Reactors"
          value={totalReactors}
          icon={<Lightning size={24} weight="bold" />}
          description="Pyrolysis equipment units"
          isLoading={isLoading}
        />
        <StatCard
          title="Method B Eligible"
          value={methodBEligibleCount}
          icon={<CheckCircle size={24} weight="bold" />}
          description="Eligible reactors on this page"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Throughput"
          value={`${totalThroughput.toLocaleString()} tph`}
          icon={<Flask size={24} weight="bold" />}
          description="Combined nominal throughput on this page"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={reactors}
        onRowClick={openView}
        enableSorting
        enablePagination
        globalFilter={searchInput}
        onGlobalFilterChange={setSearchInput}
        isLoading={isLoading}
        hoverable
        emptyMessage={
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Lightning size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">No reactors yet</h3>
              <p className="body-small text-[var(--color-text-secondary)]">
                Create your first reactor to get started
              </p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              <Plus size={18} weight="bold" />
              New Reactor
            </Button>
          </div>
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search reactors..." />
          <DataTable.ColumnVisibility />
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingReactorId}
        title="Delete Reactor"
        message="Are you sure you want to delete this reactor? This action cannot be undone. Note: Reactors with associated production runs cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingReactorId(null);
          setDeleteError(null);
        }}
        isPending={deleteReactor.isPending}
      />

      {/* Unified Side Sheet */}
      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Reactor" : sideSheet.entity?.code ?? ""}
          subtitle={sideSheet.mode === "create" ? "Add a new pyrolysis reactor" : sideSheet.entity?.identifier}
          editLabel="Edit Reactor"
          sections={sideSheet.entity ? [
            {
              title: "General Information",
              fields: [
                { label: "Code", value: sideSheet.entity.code },
                { label: "Identifier", value: sideSheet.entity.identifier },
                { label: "Reactor Type", value: formatReactorType(sideSheet.entity.reactorType) },
                { label: "Sampling Method", value: formatSamplingMethod(sideSheet.entity.samplingMethod as SamplingMethod) },
              ],
            },
            {
              title: "Facility",
              fields: [
                { label: "Facility Name", value: sideSheet.entity.facilityName },
                { label: "Facility Code", value: sideSheet.entity.facilityCode },
              ],
            },
            {
              title: "Method B Eligibility",
              fields: [
                { label: "Status", value: sideSheet.entity.methodBEligibility?.isEligible ? "Eligible" : "Not Eligible" },
                { label: "Prior Method A Samples", value: (sideSheet.entity.methodBEligibility?.priorMethodASampleCount ?? 0) + " samples" },
                { label: "Minimum Required", value: (sideSheet.entity.methodBEligibility?.minimumMethodASampleCount ?? 30) + " samples" },
              ],
            },
          ] : undefined}
        >
          {(createError || updateError) && (
            <div className="mb-24">
              <ServerError message={createError || updateError || ""} />
            </div>
          )}
          <ReactorForm
            key={sideSheet.entity?.id ?? "create"}
            reactor={sideSheet.entity as Reactor | undefined}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createReactor.isPending || updateReactor.isPending}
            submitLabel={sideSheet.entity && sideSheet.mode === "edit" ? "Save Changes" : "Create Reactor"}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
