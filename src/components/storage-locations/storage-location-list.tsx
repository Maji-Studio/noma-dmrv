/**
 * StorageLocationList — page state and side sheets for the storage board.
 *
 * The board itself (control rail + silo tiles) lives in `storage-bin-board.tsx`;
 * this file owns the query, the filter/sort state it derives, and the three
 * panels a bin can open: detail, reconcile, and delete confirmation. The page is
 * already facility-scoped, so the facility is not repeated per bin.
 */
"use client";

import { ServerError } from "@/components/forms";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Button, PageHeader } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { useDebounce } from "@/hooks/use-debounce";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import {
  useArchiveStorageLocation,
  useDeleteStorageLocation,
  useRestoreStorageLocation,
  useStorageLocations,
} from "@/hooks/use-storage-locations";
import type { StorageLocationFilterData } from "@/schemas/storage-locations";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import {
  DEFAULT_BIN_SORT,
  parseBinSortValue,
  type StorageBinTypeFilter,
} from "./bin-display";
import { BinReconcileSheet } from "./bin-reconcile-sheet";
import { StorageBinBoard } from "./storage-bin-board";
import { StorageBinSheet, type StorageBinSheetState } from "./storage-bin-sheet";

export function StorageLocationList() {
  const { facilityId } = useFacilityContext();

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<StorageBinTypeFilter>("all");
  const [sortValue, setSortValue] = useState(DEFAULT_BIN_SORT.value);
  const [showArchived, setShowArchived] = useState(false);
  const { currentPage, pageSize, setCurrentPage, setPageSize } =
    useListPagination(facilityId);
  const debouncedSearch = useDebounce(
    searchQuery,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const [sideSheet, setSideSheet] = useState<StorageBinSheetState | null>(null);
  const [reconcileKind, setReconcileKind] = useState<"loss" | "count">("count");
  const [reconcilingBin, setReconcilingBin] =
    useState<StorageLocationWithFacility | null>(null);
  const [deletingStorageLocationId, setDeletingStorageLocationId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sort = parseBinSortValue(sortValue);
  const filters: Partial<StorageLocationFilterData> = {
    search: debouncedSearch || undefined,
    facilityId: facilityId || undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    archived: showArchived,
    page: currentPage,
    pageSize,
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
  };

  const {
    data: storageLocationsData,
    isLoading,
    isPlaceholderData,
    error: fetchError,
  } = useStorageLocations(filters, { enabled: !!facilityId });

  const archiveStorageLocation = useArchiveStorageLocation();
  const restoreStorageLocation = useRestoreStorageLocation();
  const deleteStorageLocation = useDeleteStorageLocation();
  const toast = useToast();

  const storageLocations = storageLocationsData?.items ?? [];
  const totalStorageLocations = storageLocationsData?.total ?? 0;
  const totalPages = storageLocationsData?.totalPages ?? 0;
  const laneSummary = storageLocationsData?.laneSummary;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });

  const handleDelete = (id: string) => setDeletingStorageLocationId(id);

  const handleArchive = async (storageLocationId: string) => {
    setDeleteError(null);
    try {
      await archiveStorageLocation.mutateAsync(storageLocationId);
      toast.success(
        "Storage bin archived. Restore it from the archived view.",
      );
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "The storage bin was not archived. Try again.",
      );
    }
  };

  const handleRestore = async (storageLocationId: string) => {
    setDeleteError(null);
    try {
      await restoreStorageLocation.mutateAsync(storageLocationId);
      toast.success("Storage bin restored");
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "The storage bin was not restored. Try again.",
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingStorageLocationId) return;
    setDeleteError(null);
    try {
      await deleteStorageLocation.mutateAsync(deletingStorageLocationId);
      setDeletingStorageLocationId(null);
      toast.success("Storage bin deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Storage bin was not deleted. Try again.");
    }
  };

  const openCreate = () => setSideSheet({ mode: "create", entity: null });

  const openView = (storageLocation: StorageLocationWithFacility) =>
    setSideSheet({ mode: "view", entity: storageLocation });

  const openEdit = (storageLocation: StorageLocationWithFacility) =>
    setSideSheet({ mode: "edit", entity: storageLocation });

  // Reconcile lives in its own side sheet — close the detail sheet first so the
  // two panels never stack.
  const openReconcile = (storageLocation: StorageLocationWithFacility, kind: "loss" | "count" = "count") => {
    setReconcileKind(kind);
    setSideSheet(null);
    setReconcilingBin(storageLocation);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setTypeFilter("all");
    setCurrentPage(1);
  };

  const toggleShowArchived = () => {
    setShowArchived((current) => !current);
    setCurrentPage(1);
    setSideSheet(null);
  };

  const hasActiveFilters = Boolean(searchQuery) || typeFilter !== "all";

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader
          area="infrastructure"
          title="Storage"
          subtitle="Bins and stores for feedstock, biochar, and finished product"
        />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its storage bins." />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The storage could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="infrastructure"
        title="Storage"
        subtitle="Bins and stores for feedstock, biochar, and finished product"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <PlusIcon size={20} weight="bold" />
            New storage bin
          </Button>
        }
      />

      <StorageBinBoard
        bins={storageLocations}
        isLoading={isLoading}
        isStale={isPlaceholderData}
        laneSummary={laneSummary}
        total={totalStorageLocations}
        searchQuery={searchQuery}
        onSearchChange={(value) => {
          setSearchQuery(value);
          setCurrentPage(1);
        }}
        typeFilter={typeFilter}
        onTypeFilterChange={(value) => {
          setTypeFilter(value);
          setCurrentPage(1);
        }}
        sortValue={sortValue}
        onSortChange={(value) => {
          setSortValue(value);
          setCurrentPage(1);
        }}
        showArchived={showArchived}
        onToggleArchived={toggleShowArchived}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        page={currentPage}
        pageCount={totalPages}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        onCreate={openCreate}
        onView={openView}
        onEdit={openEdit}
        onArchive={handleArchive}
        onRestore={handleRestore}
        onDelete={handleDelete}
        onReconcile={openReconcile}
        onRecordLoss={(bin) => openReconcile(bin, "loss")}
      />

      {deleteError && !deletingStorageLocationId && (
        <ServerError message={deleteError} />
      )}

      <DeleteConfirmDialog
        isOpen={!!deletingStorageLocationId}
        title="Delete storage bin"
        message="Permanently delete this unused storage bin? Bins with stock or operational history must be archived instead."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingStorageLocationId(null);
          setDeleteError(null);
        }}
        isPending={deleteStorageLocation.isPending}
        errorMessage={deleteError ?? undefined}
      />

      <StorageBinSheet
        state={sideSheet}
        onStateChange={setSideSheet}
        onReconcile={openReconcile}
      />

      <BinReconcileSheet
        key={`${reconcilingBin?.id}-${reconcileKind}`}
        initialKind={reconcileKind}
        open={!!reconcilingBin}
        onOpenChange={(open) => {
          if (!open) setReconcilingBin(null);
        }}
        storageLocation={reconcilingBin}
      />
    </div>
  );
}
