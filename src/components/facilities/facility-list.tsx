/**
 * FacilityList component
 * Main facility listing with CRUD operations, stat cards, filters, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Factory, Lightning, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import type { Facility } from "@/db/schema";
import {
  useCreateFacility,
  useDeleteFacility,
  useFacilities,
  useUpdateFacility,
  useFacilityCountries,
} from "@/hooks/use-facilities";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { FacilityForm } from "./facility-form";
import type { FacilityFormData, FacilityFilterData } from "@/schemas/facilities";
import type { FacilityWithRelations } from "@/data-access/facilities";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (facility: FacilityWithRelations) => void,
  onDelete: (facilityId: string) => void
): ColumnDef<FacilityWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <Link href={`/facilities/${row.original.id}`} className="font-medium text-[var(--clr-dark-purple)] hover:underline">
          {row.original.code}
        </Link>
      ),
    },
    { accessorKey: "name", header: "Name" },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => <span className="text-[var(--color-text-secondary)]">{row.original.location || "\u2014"}</span>,
    },
    { accessorKey: "country", header: "Country" },
    {
      accessorKey: "reactorCount",
      header: "Reactors",
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-center min-w-[28px] px-8 py-2 bg-[var(--color-surface-light)] border border-[var(--color-border-tertiary)] text-[var(--text-s)] font-medium">
          {row.original.reactorCount}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-8">
          <Link href={`/facilities/${row.original.id}`} className="h-32 px-12 inline-flex items-center border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors" onClick={(e) => e.stopPropagation()}>View</Link>
          <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(row.original); }} className="h-32 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small transition-colors">Edit</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(row.original.id); }} className="h-32 px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small transition-colors">Delete</button>
        </div>
      ),
      enableSorting: false,
    },
  ];
}

// ============================================
// Component
// ============================================

export function FacilityList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [sideSheet, setSideSheet] = useState<{
    entity: FacilityWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingFacilityId, setDeletingFacilityId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<FacilityFilterData> = useMemo(() => ({
    search: searchQuery || undefined,
    country: countryFilter || undefined,
    page: currentPage,
    pageSize,
    sortBy: "name",
    sortOrder: "asc",
  }), [searchQuery, countryFilter, currentPage, pageSize]);

  const { data: facilitiesData, isLoading, error: fetchError } = useFacilities(filters);
  const { data: countries } = useFacilityCountries();

  const createFacility = useCreateFacility();
  const updateFacility = useUpdateFacility();
  const deleteFacility = useDeleteFacility();

  const facilities = facilitiesData?.items ?? [];
  const totalFacilities = facilitiesData?.total ?? 0;
  const totalPages = facilitiesData?.totalPages ?? 0;
  const totalReactors = facilities.reduce((sum, f) => sum + f.reactorCount, 0);

  const handleCreate = async (data: FacilityFormData) => {
    setCreateError(null);
    try {
      await createFacility.mutateAsync(data);
      setSideSheet(null);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create facility");
    }
  };

  const handleUpdate = async (data: FacilityFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateFacility.mutateAsync({ facilityId: sideSheet.entity.id, ...data });
      setSideSheet(null);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Failed to update facility");
    }
  };

  const handleDelete = (facilityId: string) => setDeletingFacilityId(facilityId);
  const handleDeleteConfirm = async () => {
    if (!deletingFacilityId) return;
    setDeleteError(null);
    try {
      await deleteFacility.mutateAsync(deletingFacilityId);
      setDeletingFacilityId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete facility");
    }
  };

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (facility: FacilityWithRelations) => { setSideSheet({ entity: facility, mode: "view" }); };
  const openEdit = (facility: FacilityWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: facility, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };

  const clearFilters = () => { setSearchQuery(""); setCountryFilter(""); setCurrentPage(1); };
  const hasActiveFilters = searchQuery || countryFilter;

  const columns = useMemo(() => createColumns(openEdit, handleDelete), []);

  if (fetchError) {
    return <div className="container-max py-32"><ServerError message={fetchError.message || "Failed to load facilities"} /></div>;
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Facilities</h1>
        <Button variant="primary" onClick={openCreate}><Plus size={20} weight="bold" />New Facility</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard title="Active Facilities" value={totalFacilities} icon={<Factory size={24} weight="bold" />} description="Total production facilities" isLoading={isLoading} />
        <StatCard title="Total Reactors" value={totalReactors} icon={<Lightning size={24} weight="bold" />} description="Across all facilities" isLoading={isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={facilities}
        onRowClick={openView}
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
            <Factory size={48} className="text-[var(--color-text-tertiary)]" />
            <div className="text-center">
              <h3 className="title-heading-3 mb-1">{hasActiveFilters ? "No facilities found" : "No facilities yet"}</h3>
              <p className="body-small text-[var(--color-text-secondary)]">{hasActiveFilters ? "Try adjusting your search or filters." : "Create your first facility to get started."}</p>
            </div>
            {!hasActiveFilters && <Button variant="primary" onClick={openCreate}><Plus size={20} weight="bold" />Create Facility</Button>}
          </div>
        }
      >
        <DataTable.Toolbar>
          <div className="relative max-w-[320px] flex-1">
            <MagnifyingGlass size={18} className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none" />
            <input type="text" placeholder="Search facilities..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} className="w-full h-40 pl-36 pr-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]" aria-label="Search table" />
          </div>
          <div className="flex items-center gap-8">
            <select value={countryFilter} onChange={(e) => { setCountryFilter(e.target.value); setCurrentPage(1); }} className="h-40 px-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer">
              <option value="">All Countries</option>
              {countries?.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {hasActiveFilters && <Button variant="noOutline" size="small" onClick={clearFilters}><X size={16} weight="bold" />Clear</Button>}
          </div>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog isOpen={!!deletingFacilityId} title="Delete Facility" message="Are you sure you want to delete this facility? This action cannot be undone. Note: Facilities with reactors or storage locations cannot be deleted." onConfirm={handleDeleteConfirm} onCancel={() => { setDeletingFacilityId(null); setDeleteError(null); }} isPending={deleteFacility.isPending} />

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
          title={sideSheet.mode === "create" ? "Create Facility" : sideSheet.entity?.code ?? ""}
          subtitle={sideSheet.mode === "create" ? "Fill in the form to create a new facility." : sideSheet.entity?.name}
          editLabel="Edit Facility"
          sections={sideSheet.entity ? [
            {
              title: "General Information",
              fields: [
                { label: "Code", value: sideSheet.entity.code },
                { label: "Name", value: sideSheet.entity.name },
                { label: "Location", value: sideSheet.entity.location },
                { label: "Country", value: sideSheet.entity.country },
              ],
            },
            {
              title: "Stats",
              fields: [
                { label: "Reactors", value: sideSheet.entity.reactorCount + " reactors" },
                { label: "Storage Locations", value: sideSheet.entity.storageLocationCount + " locations" },
              ],
            },
          ] : undefined}
        >
          {(createError || updateError) && <div className="mb-24"><ServerError message={createError || updateError || ""} /></div>}
          <FacilityForm
            key={sideSheet.entity?.id ?? "create"}
            facility={sideSheet.entity as Facility | undefined}
            onSubmit={sideSheet.entity && sideSheet.mode === "edit" ? handleUpdate : handleCreate}
            onCancel={closeSideSheet}
            isSubmitting={createFacility.isPending || updateFacility.isPending}
            submitLabel={sideSheet.entity && sideSheet.mode === "edit" ? "Save Changes" : "Create Facility"}
          />
        </EntitySideSheet>
      )}
    </div>
  );
}
