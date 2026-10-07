/**
 * SupplierList component
 * Main supplier listing with CRUD operations, stat cards, and DataTable
 */
"use client";
import { StaleVersionError, staleDeleteMessage } from "@/lib/stale-version";

import { useEffect, useRef, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { UsersIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import type { Supplier } from "@/db/schema";
import {
  useCreateSupplierWithLocations,
  useDeleteSupplier,
  useSuppliers,
  useSupplier,
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
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { ENTITY_DEEP_LINK_EDIT_MODE, ENTITY_DEEP_LINK_MODE_PARAM, SUPPLIER_QUERY_PARAM } from "@/lib/entity-deep-link";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { supplierSheetSections } from "./supplier-read-sections";
import { ILLUSTRATION_SIZE, SupplierArt } from "@/components/ui/illustrations";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onView: (supplier: SupplierWithRelations) => void,
  onEdit: (supplier: SupplierWithRelations) => void,
  onDelete: (supplierId: string) => void
): ColumnDef<SupplierWithRelations>[] {
  return [
    {
      accessorKey: "code",
      meta: { nowrap: true },
      header: "Code",
      cell: ({ row }) => (
        <span className="font-medium text-[var(--clr-dark-purple)]">
          {row.original.code}
        </span>
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
          ) || MISSING_VALUE.notRecorded}
        </span>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      accessorFn: (row) => row.contactName || row.contactEmail || "",
      cell: ({ row }) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.original.contactName ||
            row.original.contactEmail ||
            MISSING_VALUE.notRecorded}
        </span>
      ),
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
              { label: "Open details", onSelect: () => onView(row.original) },
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
  // Deep link (dashboard gap): ?supplier=<id>&mode=edit opens that supplier's sheet.
  const [focusedSupplierId, setFocusedSupplierId] = useQueryState(
    SUPPLIER_QUERY_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [deepLinkMode, setDeepLinkMode] = useQueryState(
    ENTITY_DEEP_LINK_MODE_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [sideSheetState, setSideSheet] = useState<{
    entity: SupplierWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingSupplierId, setDeletingSupplierId] = useState<SupplierWithRelations | null>(null);
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
  const deepLinkedSupplier = useSupplier(focusedSupplierId ?? "", !!focusedSupplierId);
  // A deep-linked sheet opens on a copy of the supplier taken once, as openEdit
  // does: a later refetch (a location save, a refused stale save) must not move
  // expectedVersion forward under the operator's old draft (#768).
  const [deepLinkSnapshotId, setDeepLinkSnapshotId] = useState<string | null>(null);
  if (!focusedSupplierId && deepLinkSnapshotId) setDeepLinkSnapshotId(null);
  if (focusedSupplierId && deepLinkedSupplier.data && !sideSheetState && deepLinkSnapshotId !== focusedSupplierId) {
    setDeepLinkSnapshotId(focusedSupplierId);
    setSideSheet({
      entity: deepLinkedSupplier.data as SupplierWithRelations,
      mode: deepLinkMode === ENTITY_DEEP_LINK_EDIT_MODE ? "edit" : "view",
    });
  }
  const sideSheet = sideSheetState;
  const clearDeepLink = () => {
    void setFocusedSupplierId(null);
    void setDeepLinkMode(null);
  };
  const sideSheetLocationsQuery = useSupplierLocationsBySupplier(
    sideSheet?.entity?.id ?? "",
    !!sideSheet?.entity,
  );
  const createSupplier = useCreateSupplierWithLocations();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const toast = useToast();
  const handledInvalidSupplierIdRef = useRef<string | null>(null);

  // Clear a deep-linked `?supplier=` that cannot be opened (deleted or
  // cross-org), with the same guard as the other list deep links.
  useEffect(() => {
    if (!focusedSupplierId) {
      handledInvalidSupplierIdRef.current = null;
      return;
    }
    if (deepLinkedSupplier.isLoading || deepLinkedSupplier.isFetching || deepLinkedSupplier.isPending) return;
    if (handledInvalidSupplierIdRef.current === focusedSupplierId) return;
    if (deepLinkedSupplier.isError || (deepLinkedSupplier.isSuccess && !deepLinkedSupplier.data)) {
      handledInvalidSupplierIdRef.current = focusedSupplierId;
      toast.error("Linked supplier could not be opened");
      void setFocusedSupplierId(null);
      void setDeepLinkMode(null);
    }
  }, [
    deepLinkedSupplier.data,
    deepLinkedSupplier.isError,
    deepLinkedSupplier.isFetching,
    deepLinkedSupplier.isLoading,
    deepLinkedSupplier.isPending,
    deepLinkedSupplier.isSuccess,
    focusedSupplierId,
    setDeepLinkMode,
    setFocusedSupplierId,
    toast,
  ]);

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
      closeSideSheet();
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
        // The version the side sheet opened on, never a refetched one, so a
        // concurrent edit is refused instead of silently overwritten (#768).
        expectedVersion: sideSheet.entity.version,
        ...data,
      });
      closeSideSheet();
      toast.success("Supplier updated.");
    } catch (error) {
      // The side sheet stays open on every failure, so the operator's draft
      // survives an expected-version refusal untouched.
      setUpdateError(toSaveErrorMessage(error, "Supplier was not saved. Try again."));
    }
  };

  const handleDelete = (supplierId: string) => {
    setDeletingSupplierId((suppliersData?.items ?? []).find((row) => row.id === supplierId) ?? null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSupplierId) return;
    setDeleteError(null);
    try {
      await deleteSupplier.mutateAsync({ supplierId: deletingSupplierId.id, expectedVersion: deletingSupplierId.version });
      setDeletingSupplierId(null);
      toast.success("Supplier deleted.");
    } catch (error) {
      if (error instanceof StaleVersionError) setDeletingSupplierId(null);
      setDeleteError(
        error instanceof StaleVersionError ? staleDeleteMessage(`Supplier ${deletingSupplierId.code}`) : error instanceof Error ? error.message : "Supplier was not deleted. Try again."
      );
    }
  };

  const openCreate = () => { clearDeepLink(); setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (supplier: SupplierWithRelations) => { clearDeepLink(); setSideSheet({ entity: supplier, mode: "view" }); };
  const openEdit = (supplier: SupplierWithRelations) => { clearDeepLink(); setCreateError(null); setUpdateError(null); setSideSheet({ entity: supplier, mode: "edit" }); };
  const closeSideSheet = () => { clearDeepLink(); setSideSheet(null); setCreateError(null); setUpdateError(null); };
  useOpenCreateIntent(openCreate);

  const columns = createColumns(openView, openEdit, handleDelete);

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
    sideSheetMode === "create" ? "Create supplier" : sideSheetEntity?.code ?? "";

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
            New supplier
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-24">
        <StatCard
          title="Total suppliers"
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
            icon={hasActiveSearch ? <UsersIcon size={48} /> : <SupplierArt size={ILLUSTRATION_SIZE.empty} />}
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
        title="Delete supplier"
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
        onModeChange={(mode) => setSideSheet(sideSheet ? { ...sideSheet, mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit supplier"
        sections={sideSheetEntity ? supplierSheetSections(sideSheetEntity, sideSheetLocationsQuery) : undefined}
      >
        <SupplierForm
          key={sideSheetEntity?.id ?? "create"}
          supplier={sideSheet?.entity as Supplier | undefined}
          supplierId={sideSheetEntity && sideSheetMode === "edit" ? sideSheetEntity.id : undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createSupplier.isPending || updateSupplier.isPending}
          errorMessage={createError || updateError || undefined}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save changes" : "Create supplier"}
        />
      </EntitySideSheet>
    </div>
  );
}
