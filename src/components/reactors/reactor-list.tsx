/**
 * ReactorList component
 * Main reactor listing with CRUD operations using DataTable
 * Includes stat cards and unified EntitySideSheet
 */
"use client";

import { useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import type { ColumnDef } from "@tanstack/react-table";
import { LightningIcon, FlaskIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { ReactorForm } from "./reactor-form";
import {
  useCreateReactor,
  useDeleteReactor,
  useReactors,
  useUpdateReactor,
} from "@/hooks/use-reactors";
import {
  formatReactorType,
  type CreateReactorData,
} from "@/schemas/reactors";
import type { ReactorWithRelations } from "@/data-access/reactors";
import type { Reactor } from "@/db/schema";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { formatTotalThroughputTph } from "./reactor-throughput";
import { MISSING_VALUE } from "@/lib/copy-utils";

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
      meta: { nowrap: true },
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
          <span>{row.original.facilityName || MISSING_VALUE.notAvailable}</span>
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
      id: "actions",
      meta: { stickyEnd: true },
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
            actions={[
              { label: "Edit", onSelect: () => onEdit(row.original) },
              { label: "Delete", destructive: true, onSelect: () => onDelete(row.original.id) },
            ]}
          />
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
  const { facilityId: contextFacilityId } = useFacilityContext();

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
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(contextFacilityId);
  const debouncedSearch = useDebounce(
    searchInput,
    LIST_SEARCH_DEBOUNCE_MS,
  );
  const filters = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(contextFacilityId ? { facilityId: contextFacilityId } : {}),
    page: currentPage,
    pageSize,
  };

  const { data: reactorsData, isLoading, error: fetchError } = useReactors(
    filters,
    { enabled: !!contextFacilityId },
  );
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
  const handleCreate = async (data: CreateReactorData) => {
    setCreateError(null);
    try {
      await createReactor.mutateAsync(data);
      setSideSheet(null);
      toast.success("Reactor created.");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Reactor was not created. Check the form.");
    }
  };

  const handleUpdate = async (data: CreateReactorData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateReactor.mutateAsync({ reactorId: sideSheet.entity.id, ...data });
      setSideSheet(null);
      toast.success("Reactor updated.");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Reactor was not saved. Try again.");
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
      toast.success("Reactor deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Reactor was not deleted. Try again.");
    }
  };

  const columns = createColumns(openEdit, handleDelete);

  const reactors = reactorsData?.items ?? [];
  const totalReactors = reactorsData?.total ?? 0;
  const totalPages = reactorsData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const totalThroughputValue = formatTotalThroughputTph(reactors);
  const hasActiveSearch = searchInput.trim().length > 0;

  if (!contextFacilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="infrastructure"
          title="Reactors"
          subtitle="Pyrolysis equipment and facility capacity"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its reactors." />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The reactors could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Reactor" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" ? undefined : sideSheetEntity?.identifier;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="infrastructure"
        title="Reactors"
        subtitle="Pyrolysis equipment and facility capacity"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={18} weight="bold" />
            New Reactor
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
        <StatCard
          title="Total Reactors"
          value={totalReactors}
          icon={<LightningIcon size={24} weight="bold" />}
          description="Pyrolysis equipment units"
          isLoading={isLoading}
        />
        <StatCard
          title="Throughput on This Page"
          value={totalThroughputValue}
          icon={<FlaskIcon size={24} weight="bold" />}
          description="Combined nominal throughput on this page"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={reactors}
        onRowClick={openView}
        enableSorting={false}
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        globalFilter={searchInput}
        onGlobalFilterChange={(value) => {
          setSearchInput(value);
          setCurrentPage(1);
        }}
        onPaginationChange={onPaginationChange}
        aria-label="Reactors"
        isLoading={isLoading}
        hoverable
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<LightningIcon size={48} />}
            title={hasActiveSearch ? "No matching reactors" : "No reactors yet"}
            description={hasActiveSearch ? "Try clearing your search." : undefined}
            action={
              !hasActiveSearch ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={18} weight="bold" />
                  Create your first reactor
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search reactors..."
            aria-label="Search reactors"
          />
          <DataTable.Controls>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
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
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Reactor"
        sections={sideSheetEntity ? [
          {
            title: "Required information",
            fields: [
              { label: "Identifier", value: sideSheetEntity.identifier },
            ],
          },
          {
            title: "Reactor configuration",
            fields: [
              { label: "Reactor type", value: formatReactorType(sideSheetEntity.reactorType) },
              { label: "Nominal throughput (tph)", value: sideSheetEntity.nominalThroughputTph },
            ],
          },
        ] : undefined}
      >
        <ReactorForm
          key={sideSheetEntity?.id ?? "create"}
          reactor={sideSheetEntity as Reactor | undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createReactor.isPending || updateReactor.isPending}
          errorMessage={createError || updateError || undefined}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Reactor"}
        />
      </EntitySideSheet>
    </div>
  );
}
