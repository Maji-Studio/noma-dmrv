/**
 * StorageLocationList component
 * Main storage location listing with CRUD operations, stat cards, filters, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Cube, MagnifyingGlass, Plus, X, Factory } from "@phosphor-icons/react";
import type { StorageLocation } from "@/db/schema";
import {
  useCreateStorageLocation,
  useDeleteStorageLocation,
  useStorageLocations,
  useUpdateStorageLocation,
} from "@/hooks/use-storage-locations";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { StorageLocationForm } from "./storage-location-form";
import {
  formatStorageLocationType,
  type StorageLocationFormData,
  type StorageLocationFilterData,
} from "@/schemas/storage-locations";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (sl: StorageLocationWithFacility) => void,
  onDelete: (slId: string) => void
): ColumnDef<StorageLocationWithFacility>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => <span className="font-medium text-[var(--clr-dark-purple)]">{row.original.code}</span>,
    },
    { accessorKey: "name", header: "Name" },
    {
      id: "facility",
      header: "Facility",
      accessorFn: (row) => row.facilityCode ?? "",
      cell: ({ row }) => (
        <Link href={`/facilities/${row.original.facilityId}`} className="text-[var(--color-text-secondary)] hover:underline">
          {row.original.facilityCode}
        </Link>
      ),
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <span className="inline-flex items-center px-8 py-2 bg-[var(--color-surface-light)] border border-[var(--color-border-tertiary)] text-[var(--text-xs)]">
          {formatStorageLocationType(row.original.type)}
        </span>
      ),
    },
    {
      accessorKey: "capacityKg",
      header: "Capacity (kg)",
      cell: ({ row }) => row.original.capacityKg ? row.original.capacityKg.toLocaleString() : "\u2014",
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-8">
          <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(row.original); }} className="h-32 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors">Edit</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(row.original.id); }} className="h-32 px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small transition-colors">Delete</button>
        </div>
      ),
      enableSorting: false,
    },
  ];
}

// ============================================
// Side Sheet State
// ============================================

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: StorageLocationWithFacility }
  | { mode: "edit"; entity: StorageLocationWithFacility };

// ============================================
// Component
// ============================================

export function StorageLocationList() {
  const { facilityId } = useFacilityContext();

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingStorageLocationId, setDeletingStorageLocationId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Build a filter key so pagination resets when filters change
  const filterKey = `${facilityId ?? ""}-${typeFilter}-${searchQuery}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    if (currentPage !== 1) setCurrentPage(1);
  }

  const effectivePage = filterKey !== lastFilterKey ? 1 : currentPage;

  const filters: Partial<StorageLocationFilterData> = useMemo(() => ({
    search: searchQuery || undefined,
    facilityId: facilityId || undefined,
    type: (typeFilter as StorageLocationFilterData["type"]) || undefined,
    page: effectivePage,
    pageSize,
    sortBy: "code",
    sortOrder: "asc",
  }), [searchQuery, facilityId, typeFilter, effectivePage, pageSize]);

  const { data: storageLocationsData, isLoading, error: fetchError } = useStorageLocations(filters);

  const createStorageLocation = useCreateStorageLocation();
  const updateStorageLocation = useUpdateStorageLocation();
  const deleteStorageLocation = useDeleteStorageLocation();
  const toast = useToast();

  const storageLocations = storageLocationsData?.items ?? [];
  const totalStorageLocations = storageLocationsData?.total ?? 0;
  const totalPages = storageLocationsData?.totalPages ?? 0;
  const pageCapacity = storageLocations.reduce((sum, sl) => sum + (sl.capacityKg ?? 0), 0);

  const handleCreate = async (data: StorageLocationFormData) => {
    setFormError(null);
    try {
      await createStorageLocation.mutateAsync(data);
      setSideSheet(null);
      toast.success("Storage location created successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create storage location");
    }
  };

  const handleUpdate = async (data: StorageLocationFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    try {
      await updateStorageLocation.mutateAsync({ storageLocationId: sideSheet.entity.id, ...data });
      setSideSheet(null);
      toast.success("Storage location updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update storage location");
    }
  };

  const handleDelete = (id: string) => setDeletingStorageLocationId(id);
  const handleDeleteConfirm = async () => {
    if (!deletingStorageLocationId) return;
    setDeleteError(null);
    try {
      await deleteStorageLocation.mutateAsync(deletingStorageLocationId);
      setDeletingStorageLocationId(null);
      toast.success("Storage location deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete storage location");
    }
  };

  const openCreate = () => { setFormError(null); setSideSheet({ mode: "create", entity: null }); };
  const openView = (sl: StorageLocationWithFacility) => { setFormError(null); setSideSheet({ mode: "view", entity: sl }); };
  const openEdit = (sl: StorageLocationWithFacility) => { setFormError(null); setSideSheet({ mode: "edit", entity: sl }); };
  const closeSideSheet = () => { setSideSheet(null); setFormError(null); };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!sideSheet) return;
    setFormError(null);
    if (mode === "edit" && sideSheet.entity) {
      setSideSheet({ mode: "edit", entity: sideSheet.entity });
    } else if (mode === "view" && sideSheet.entity) {
      setSideSheet({ mode: "view", entity: sideSheet.entity });
    }
  };

  const clearFilters = () => { setSearchQuery(""); setTypeFilter(""); setCurrentPage(1); };
  const hasActiveFilters = searchQuery || typeFilter;

  const editingEntity = sideSheet?.mode === "edit" ? sideSheet.entity : null;
  const isSubmitting = createStorageLocation.isPending || updateStorageLocation.isPending;

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (fetchError) {
    return <div className="container-max py-32"><ServerError message={fetchError.message || "Failed to load storage locations"} /></div>;
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Storage Locations</h1>
        <Button variant="primary" onClick={openCreate}><Plus size={20} weight="bold" />New Storage Location</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard title="Storage Locations" value={totalStorageLocations} icon={<Cube size={24} weight="bold" />} description="Total storage locations" isLoading={isLoading} />
        <StatCard title="Page Capacity" value={`${(pageCapacity / 1000).toFixed(1)} t`} icon={<Factory size={24} weight="bold" />} description="Combined capacity on this page" isLoading={isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={storageLocations}
        onRowClick={(row) => openView(row)}
        enableSorting
        enablePagination
        manualPagination
        pageCount={totalPages}
        pageSize={pageSize}
        pageIndex={currentPage - 1}
        onPaginationChange={(p) => {
          if (p.pageSize !== pageSize) { setPageSize(p.pageSize); setCurrentPage(1); }
          else { setCurrentPage(p.pageIndex + 1); }
        }}
        isLoading={isLoading}
        hoverable
        emptyMessage={
          <div className="flex flex-col items-center justify-center gap-24 py-48">
            <Cube size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">{hasActiveFilters ? "No storage locations found" : "No storage locations yet"}</h3>
              <p className="body-small text-[var(--color-text-secondary)]">{hasActiveFilters ? "Try adjusting your search or filters." : "Create your first storage location to get started."}</p>
            </div>
            {!hasActiveFilters && <Button variant="primary" onClick={openCreate}><Plus size={20} weight="bold" />Create Storage Location</Button>}
          </div>
        }
      >
        <DataTable.Toolbar>
          <div className="relative max-w-[320px] flex-1">
            <MagnifyingGlass size={18} className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none" />
            <input type="text" placeholder="Search storage locations..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} className="w-full h-40 pl-36 pr-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]" aria-label="Search table" />
          </div>
          <div className="flex items-center gap-8">
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }} className="h-40 px-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer">
              <option value="">All Types</option>
              <option value="feedstock_bin">Feedstock Bin</option>
              <option value="biochar_bin">Biochar Bin</option>
              <option value="product_bin">Product Bin</option>
            </select>
            {hasActiveFilters && <Button variant="noOutline" size="small" onClick={clearFilters}><X size={16} weight="bold" />Clear</Button>}
          </div>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog
        isOpen={!!deletingStorageLocationId}
        title="Delete Storage Location"
        message="Are you sure you want to delete this storage location? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeletingStorageLocationId(null); setDeleteError(null); }}
        isPending={deleteStorageLocation.isPending}
      />

      <EntitySideSheet
        open={!!sideSheet}
        onOpenChange={(open) => { if (!open) closeSideSheet(); }}
        mode={sideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        title={sideSheet?.mode === "create" ? "Create Storage Location" : (sideSheet?.entity?.code ?? "")}
        subtitle={sideSheet?.mode === "create" ? "Fill in the form to create a new storage location." : sideSheet?.entity?.name}
        editLabel="Edit Storage Location"
        sections={sideSheet?.mode === "view" && sideSheet.entity ? [
          {
            title: "General Information",
            fields: [
              { label: "Code", value: sideSheet.entity.code },
              { label: "Name", value: sideSheet.entity.name },
              { label: "Type", value: formatStorageLocationType(sideSheet.entity.type) },
              { label: "Capacity", value: sideSheet.entity.capacityKg ? sideSheet.entity.capacityKg.toLocaleString() + " kg" : null },
            ],
          },
          {
            title: "Facility",
            fields: [
              { label: "Facility Name", value: sideSheet.entity.facilityName },
              { label: "Facility Code", value: sideSheet.entity.facilityCode },
            ],
          },
        ] : undefined}
      >
        {formError && <div className="mb-24"><ServerError message={formError} /></div>}
        <StorageLocationForm
          key={editingEntity?.id ?? "create"}
          storageLocation={editingEntity as StorageLocation | undefined}
          defaultFacilityId={facilityId ?? undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          submitLabel={sideSheet?.mode === "edit" ? "Save Changes" : "Create Storage Location"}
        />
      </EntitySideSheet>
    </div>
  );
}
