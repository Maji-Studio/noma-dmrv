/**
 * SupplierList component
 * Main supplier listing with CRUD operations, stat cards, and DataTable
 */
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { UsersIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import type { Supplier } from "@/db/schema";
import {
  useCreateSupplierWithLocations,
  useDeleteSupplier,
  useSuppliers,
  useSupplierLocationsBySupplier,
  useUpdateSupplier,
} from "@/hooks/use-suppliers";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { DataTable } from "@/components/ui/data-table";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EntitySideSheet, type SideSheetMode } from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader, RowActionsMenu } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { SupplierForm, type PendingSupplierLocation } from "./supplier-form";
import type { SupplierFormData } from "@/schemas/suppliers";
import type { SupplierWithRelations } from "@/data-access/suppliers";
import { resolveSupplierLocationText } from "@/lib/supplier-location-display";
import { buildPartyLocationDetailFields } from "@/components/party-location-detail-fields";
import { buildSupplierFallbackDistanceField } from "./supplier-detail-fields";
import { SupplierLocationsReadState } from "./supplier-locations-read-state";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onEdit: (supplier: SupplierWithRelations) => void,
  onDelete: (supplierId: string) => void
): ColumnDef<SupplierWithRelations>[] {
  return [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <Link
          href={`/suppliers/${row.original.id}`}
          className="font-medium text-[var(--clr-dark-purple)] hover:underline"
        >
          {row.original.code}
        </Link>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      id: "location",
      header: "Location",
      accessorFn: (row) =>
        resolveSupplierLocationText(row.location, row.defaultLocationDisplay) || "",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {resolveSupplierLocationText(
            row.original.location,
            row.original.defaultLocationDisplay,
          ) || "Not recorded"}
        </span>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      accessorFn: (row) => row.contactName || row.contactEmail || "",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.contactName || row.original.contactEmail || "Not recorded"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.code}`}
            actions={[
              { label: "Open details", href: `/suppliers/${row.original.id}` },
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

export function SupplierList() {
  const [sideSheet, setSideSheet] = useState<{
    entity: SupplierWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination();
  const normalizedSearch = searchInput.trim();
  const debouncedSearch = useDebounce(
    normalizedSearch,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const { data: suppliersData, isLoading, error: fetchError } = useSuppliers({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    page: currentPage,
    pageSize,
  });
  const sideSheetLocationsQuery = useSupplierLocationsBySupplier(
    sideSheet?.entity?.id ?? "",
    !!sideSheet?.entity,
  );
  const sideSheetLocations = sideSheetLocationsQuery.data ?? [];
  const createSupplier = useCreateSupplierWithLocations();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const toast = useToast();

  const suppliers = suppliersData?.items ?? [];

  // Computed stats
  const totalSuppliers = suppliersData?.total ?? 0;
  const totalPages = suppliersData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
  const hasActiveSearch = normalizedSearch.length > 0;
  // Handlers
  const handleCreate = async (
    data: SupplierFormData,
    pendingLocations?: PendingSupplierLocation[]
  ) => {
    setCreateError(null);
    try {
      await createSupplier.mutateAsync({
        supplier: data,
        locations: pendingLocations ?? [],
      });
      setSideSheet(null);
      toast.success("Supplier created.");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Supplier was not created. Check the form."
      );
    }
  };

  const handleUpdate = async (data: SupplierFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateSupplier.mutateAsync({
        supplierId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
      toast.success("Supplier updated.");
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Supplier was not saved. Try again."
      );
    }
  };

  const handleDelete = (supplierId: string) => {
    setDeletingSupplierId(supplierId);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSupplierId) return;
    setDeleteError(null);
    try {
      await deleteSupplier.mutateAsync(deletingSupplierId);
      setDeletingSupplierId(null);
      toast.success("Supplier deleted.");
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Supplier was not deleted. Try again."
      );
    }
  };

  const openCreate = () => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (supplier: SupplierWithRelations) => { setSideSheet({ entity: supplier, mode: "view" }); };
  const openEdit = (supplier: SupplierWithRelations) => { setCreateError(null); setUpdateError(null); setSideSheet({ entity: supplier, mode: "edit" }); };
  const closeSideSheet = () => { setSideSheet(null); setCreateError(null); setUpdateError(null); };
  useOpenCreateIntent(openCreate);

  const columns = useMemo(() => createColumns(openEdit, handleDelete), [openEdit, handleDelete]);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The suppliers could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Supplier" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" ? undefined : sideSheetEntity?.name || undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Suppliers"
        subtitle="Biomass suppliers and their source sites"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New Supplier
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total Suppliers"
          value={totalSuppliers}
          icon={<UsersIcon size={24} weight="bold" />}
          description="Biomass feedstock providers"
          isLoading={isLoading}
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={suppliers}
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
        aria-label="Suppliers"
        isLoading={isLoading}
        hoverable
        onRowClick={(row) => openView(row)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<UsersIcon size={48} />}
            title={hasActiveSearch ? "No matching suppliers" : "No suppliers yet"}
            description={
              hasActiveSearch
                ? "Try clearing your search."
                : "Suppliers are where your feedstock deliveries come from."
            }
            action={
              !hasActiveSearch ? (
                <Button variant="primary" onClick={openCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create your first supplier
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search
            placeholder="Search suppliers..."
            aria-label="Search suppliers"
          />
          <DataTable.Controls>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {/* Delete Error */}
      {deleteError && <ServerError message={deleteError} />}

      {/* Delete Confirm Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingSupplierId}
        title="Delete Supplier"
        message="Are you sure you want to delete this supplier? This action cannot be undone. Note: Suppliers with associated feedstock deliveries cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingSupplierId(null);
          setDeleteError(null);
        }}
        isPending={deleteSupplier.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) => setSideSheet((prev) => prev ? { ...prev, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Supplier"
        sections={sideSheetEntity ? [
          {
            title: "Required information",
            fields: [
              { label: "Supplier name", value: sideSheetEntity.name },
            ],
          },
          {
            title: "Locations",
            fields:
              sideSheetLocationsQuery.data === undefined
                ? []
                : buildPartyLocationDetailFields(sideSheetLocations, {
                    distanceLabel:
                      "One-way distance to facility (per leg, km)",
                    defaultLabel: "Default source location",
                    positionLabel: "Source location position",
                  }),
            content: (
              <SupplierLocationsReadState
                isPending={sideSheetLocationsQuery.isPending}
                isError={sideSheetLocationsQuery.isError}
                isRetrying={sideSheetLocationsQuery.isFetching}
                onRetry={() => void sideSheetLocationsQuery.refetch()}
              />
            ),
          },
          {
            title: "Contact information",
            fields: [
              { label: "Contact name", value: sideSheetEntity.contactName },
              { label: "Contact email", value: sideSheetEntity.contactEmail },
              { label: "Contact phone", value: sideSheetEntity.contactPhone },
            ],
          },
          {
            title: "Sourcing information",
            fields: [
              { label: "Location", value: sideSheetEntity.location },
              { label: "Source region", value: sideSheetEntity.sourceRegion },
              { label: "Address", value: sideSheetEntity.address },
              buildSupplierFallbackDistanceField({
                defaultLocationDistanceKm:
                  sideSheetLocations.find((location) => location.isDefault)
                    ?.distanceFromFacilityKm ?? null,
                legacySupplierDistanceKm:
                  sideSheetEntity.distanceToFacilityKm,
                locationsLoaded:
                  sideSheetLocationsQuery.data !== undefined,
              }),
            ],
          },
        ] : undefined}
      >
        <SupplierForm
          key={sideSheetEntity?.id ?? "create"}
          supplier={sideSheet?.entity as Supplier | undefined}
          supplierId={sideSheetEntity && sideSheetMode === "edit" ? sideSheetEntity.id : undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createSupplier.isPending || updateSupplier.isPending}
          errorMessage={createError || updateError || undefined}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Supplier"}
        />
      </EntitySideSheet>
    </div>
  );
}
