/**
 * SupplierList component
 * Main supplier listing with CRUD operations, stat cards, and DataTable
 */
"use client";
import { entityViewHref } from "@/lib/entity-deep-link";
import { StaleVersionError, toDeleteErrorMessage, toArchiveRestoreErrorMessage } from "@/lib/stale-version";

import { useEffect, useRef, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { ArchiveIcon, UsersIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import type { Supplier } from "@/db/schema";
import {
  useArchiveSupplier,
  useCreateSupplierWithLocations,
  useDeleteSupplier,
  useRestoreSupplier,
  useSuppliers,
  useSupplier,
  useFetchSupplier,
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
import { InUseDeleteDialog } from "@/components/ui/in-use-delete-dialog";
import { isInUseDeleteRefusal } from "@/components/ui/lifecycle-notices";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { ArchivedSupplierNotice } from "@/components/parties";
import { SupplierForm, type PendingSupplierLocation } from "./supplier-form";
import type { SupplierFormData } from "@/schemas/suppliers";
import type { SupplierWithRelations } from "@/data-access/suppliers";
import { resolveSupplierLocationText } from "@/lib/supplier-location-display";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { ENTITY_DEEP_LINK_EDIT_MODE, ENTITY_DEEP_LINK_MODE_PARAM, SUPPLIER_QUERY_PARAM, LOCATION_DEEP_LINK_PARAM } from "@/lib/entity-deep-link";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { supplierSheetSections } from "./supplier-read-sections";
import { ILLUSTRATION_SIZE, SupplierArt } from "@/components/ui/illustrations";

// ============================================
// Column Definitions
// ============================================

function createColumns(
  onView: (supplier: SupplierWithRelations) => void,
  onEdit: (supplier: SupplierWithRelations) => void,
  onArchive: (supplier: SupplierWithRelations) => void,
  onRestore: (supplier: SupplierWithRelations) => void,
  onDelete: (supplierId: string) => void
): ColumnDef<SupplierWithRelations>[] {
  return [
    {
      accessorKey: "code",
      meta: { nowrap: true, recordLink: true },
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
              ...(row.original.archivedAt
                ? [{ label: "Restore", onSelect: () => onRestore(row.original) }]
                : [
                    { label: "Edit", onSelect: () => onEdit(row.original) },
                    { label: "Archive", onSelect: () => onArchive(row.original) },
                  ]),
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
  const [, setLocationIntent] = useQueryState(LOCATION_DEEP_LINK_PARAM, parseAsString.withOptions({ shallow: true, history: "replace" }));
  const [deepLinkMode, setDeepLinkMode] = useQueryState(
    ENTITY_DEEP_LINK_MODE_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const [sideSheetState, setSideSheet] = useState<{
    entity: SupplierWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState<SupplierWithRelations | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<SupplierWithRelations | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { currentPage, pageSize, setCurrentPage, onPaginationChange } =
    useListPagination(showArchived ? "archived" : "active");
  const normalizedSearch = searchInput.trim();
  const debouncedSearch = useDebounce(
    normalizedSearch,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const { data: suppliersData, isLoading, error: fetchError } = useSuppliers({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    archived: showArchived,
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
    const linked = deepLinkedSupplier.data as SupplierWithRelations;
    setSideSheet({
      entity: linked,
      // An archived supplier is read-only, whatever mode the link asks for.
      mode: deepLinkMode === ENTITY_DEEP_LINK_EDIT_MODE && !linked.archivedAt ? "edit" : "view",
    });
  }
  const sideSheet = sideSheetState;
  const clearDeepLink = () => {
    void setFocusedSupplierId(null);
    void setDeepLinkMode(null);
    // An unconsumed `location=` (archived suppliers open read-only) must not
    // pop a dialog once the supplier is restored and edited.
    void setLocationIntent(null);
  };
  const sideSheetLocationsQuery = useSupplierLocationsBySupplier(
    sideSheet?.entity?.id ?? "",
    !!sideSheet?.entity,
  );
  const createSupplier = useCreateSupplierWithLocations();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const archiveSupplier = useArchiveSupplier();
  const restoreSupplier = useRestoreSupplier();
  const toast = useToast();
  const fetchSupplier = useFetchSupplier();
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
    setDeleteConflict(null);
    setDeleteError(null);
    setDeletingSupplier((suppliersData?.items ?? []).find((row) => row.id === supplierId) ?? null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSupplier) return;
    setDeleteError(null);
    try {
      await deleteSupplier.mutateAsync({ supplierId: deletingSupplier.id, expectedVersion: deletingSupplier.version });
      setDeletingSupplier(null);
      toast.success("Supplier deleted.");
    } catch (error) {
      const message = toDeleteErrorMessage(error, `Supplier ${deletingSupplier.code}`, "Supplier was not deleted. Try again.");
      if (isInUseDeleteRefusal(message) && !deletingSupplier.archivedAt) {
        // In use: the dialog gives way to the in-use dialog that offers Archive instead.
        setDeleteConflict(deletingSupplier);
        setDeletingSupplier(null);
        return;
      }
      if (error instanceof StaleVersionError) setDeletingSupplier(null);
      setDeleteError(message);
    }
  };

  // A refused archive or restore means the sheet's copy of the row is stale
  // (a deep-linked archived supplier is not in the active list, so the list
  // cannot supply a fresher one). Take the current row, or close the sheet
  // when it is gone, so the next Restore carries a version the server knows.
  // The operator may close the sheet or open another one while the reload
  // runs, so both outcomes apply only to a sheet still showing this supplier.
  const resnapshotSheet = async (supplier: SupplierWithRelations) => {
    if (sideSheetState?.entity?.id !== supplier.id) return;
    const current = await fetchSupplier(supplier.id).catch(() => null);
    const stillOpen = (sheet: { entity: SupplierWithRelations | null } | null) => sheet?.entity?.id === supplier.id;
    if (current) {
      setSideSheet((sheet) => (stillOpen(sheet) ? { entity: current as SupplierWithRelations, mode: "view" } : sheet));
      return;
    }
    setSideSheet((sheet) => (stillOpen(sheet) ? null : sheet));
    toast.error(`Supplier ${supplier.code} could not be reloaded. Open it again from the list.`);
  };

  const handleArchive = async (supplier: SupplierWithRelations) => {
    // Act on the list's current row: the snapshot a notice or sheet holds goes stale after a refused version.
    const fresh = (suppliersData?.items ?? []).find((row) => row.id === supplier.id);
    const target = fresh ?? supplier;
    setLifecycleError(null);
    try {
      await archiveSupplier.mutateAsync({ supplierId: supplier.id, expectedVersion: target.version });
      setDeleteConflict(null);
      toast.success(`Supplier ${supplier.code} archived. Restore it from the archived view.`);
    } catch (error) {
      // Without a fresh row the notice would keep the stale version, so drop it.
      if (error instanceof StaleVersionError && !fresh) setDeleteConflict(null);
      if (error instanceof StaleVersionError) await resnapshotSheet(supplier);
      setLifecycleError(toArchiveRestoreErrorMessage(error, `Supplier ${supplier.code}`, "archive", "The supplier was not archived. Try again."));
    }
  };

  const handleRestore = async (supplier: SupplierWithRelations) => {
    // Act on the list's current row: the snapshot a notice or sheet holds goes stale after a refused version.
    const fresh = (suppliersData?.items ?? []).find((row) => row.id === supplier.id);
    const target = fresh ?? supplier;
    setLifecycleError(null);
    try {
      await restoreSupplier.mutateAsync({ supplierId: supplier.id, expectedVersion: target.version });
      closeSideSheet();
      toast.success(`Supplier ${supplier.code} restored.`);
    } catch (error) {
      if (error instanceof StaleVersionError) await resnapshotSheet(supplier);
      setLifecycleError(toArchiveRestoreErrorMessage(error, `Supplier ${supplier.code}`, "restore", "The supplier was not restored. Try again."));
    }
  };

  const toggleShowArchived = () => {
    setShowArchived((current) => !current);
    setCurrentPage(1);
    closeSideSheet();
    setDeleteConflict(null);
    setLifecycleError(null);
  };

  const openCreate = () => { clearDeepLink(); setCreateError(null); setUpdateError(null); setSideSheet({ entity: null, mode: "create" }); };
  const openView = (supplier: SupplierWithRelations) => { clearDeepLink(); setSideSheet({ entity: supplier, mode: "view" }); };
  const openEdit = (supplier: SupplierWithRelations) => { clearDeepLink(); setCreateError(null); setUpdateError(null); setSideSheet({ entity: supplier, mode: "edit" }); };
  const closeSideSheet = () => { clearDeepLink(); setSideSheet(null); setCreateError(null); setUpdateError(null); setLifecycleError(null); };
  useOpenCreateIntent(openCreate);

  const columns = createColumns(openView, openEdit, handleArchive, handleRestore, handleDelete);

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

  const viewedEntity = sideSheetMode === "view" ? sideSheetEntity : null;

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
          title={showArchived ? "Archived suppliers" : "Active suppliers"}
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
        getRowHref={(row) => entityViewHref("/suppliers", SUPPLIER_QUERY_PARAM, row.id)}
        emptyMessage={
          <EmptyState
            padding="md"
            icon={hasActiveSearch ? <UsersIcon size={48} /> : <SupplierArt size={ILLUSTRATION_SIZE.empty} />}
            title={
              hasActiveSearch
                ? showArchived ? "No archived suppliers match" : "No matching suppliers"
                : showArchived ? "No archived suppliers" : "No suppliers yet"
            }
            description={
              hasActiveSearch
                ? "Try clearing your search."
                : showArchived
                  ? "Suppliers you archive will appear here and can be restored."
                  : "Suppliers are where your feedstock intakes come from."
            }
            action={
              !hasActiveSearch && !showArchived ? (
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
            <Button
              variant={showArchived ? "primary" : "default"}
              size="small"
              onClick={toggleShowArchived}
              aria-pressed={showArchived}
            >
              <ArchiveIcon size={16} weight="bold" />
              Archived
            </Button>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>

      {deleteConflict && (
        <InUseDeleteDialog
          label={deleteConflict.code}
          onArchive={() => handleArchive(deleteConflict)}
          onClose={() => {
            setDeleteConflict(null);
            setLifecycleError(null);
          }}
          isPending={archiveSupplier.isPending}
          errorMessage={lifecycleError}
        />
      )}

      {((lifecycleError && !viewedEntity && !deleteConflict) || (deleteError && !deletingSupplier)) && (
        <ServerError message={(!viewedEntity ? lifecycleError : null) ?? deleteError ?? ""} />
      )}

      {/* Delete Confirm Dialog */}
      <DeleteConfirmDialog
        isOpen={!!deletingSupplier}
        title="Delete supplier"
        message="Are you sure you want to delete this supplier and its locations? This action cannot be undone. Note: Suppliers used by feedstock intakes cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingSupplier(null);
          setDeleteError(null);
        }}
        isPending={deleteSupplier.isPending}
        errorMessage={deleteError ?? undefined}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        // An archived supplier stays in view mode: Restore is the way back to editing.
        onModeChange={(mode) => setSideSheet(sideSheet ? { ...sideSheet, mode: mode === "edit" && sideSheet.entity?.archivedAt ? "view" : mode } : null)}
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit supplier"
        canEdit={!viewedEntity?.archivedAt}
        viewModeNotice={
          viewedEntity?.archivedAt ? (
            <>
              <ArchivedSupplierNotice
                onRestore={() => handleRestore(viewedEntity)}
                isPending={restoreSupplier.isPending}
              />
              {lifecycleError && <ServerError message={lifecycleError} />}
            </>
          ) : undefined
        }
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
