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
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { useToast } from "@/components/ui/toast";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocation } from "@/db/schema";
import { useDebounce } from "@/hooks/use-debounce";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import {
  useArchiveStorageLocation,
  useCreateStorageLocation,
  useDeleteStorageLocation,
  useRestoreStorageLocation,
  useStorageLocations,
  useUpdateStorageLocation,
} from "@/hooks/use-storage-locations";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { type StorageLocationFilterData, type StorageLocationFormData } from "@/schemas/storage-locations";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import {
  DEFAULT_BIN_SORT,
  parseBinSortValue,
  type StorageBinTypeFilter,
} from "./bin-display";
import { BinReconcileSheet } from "./bin-reconcile-sheet";
import { StorageBinBoard } from "./storage-bin-board";
import { StorageLocationForm } from "./storage-location-form";
import { storageLocationSheetSections } from "./storage-location-read-sections";

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: StorageLocationWithFacility }
  | { mode: "edit"; entity: StorageLocationWithFacility };

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

  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [reconcileKind, setReconcileKind] = useState<"loss" | "count">("count");
  const [reconcilingBin, setReconcilingBin] =
    useState<StorageLocationWithFacility | null>(null);
  const [deletingStorageLocationId, setDeletingStorageLocationId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
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

  const createStorageLocation = useCreateStorageLocation();
  const updateStorageLocation = useUpdateStorageLocation();
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

  const handleCreate = async (data: StorageLocationFormData) => {
    setFormError(null);
    try {
      await createStorageLocation.mutateAsync(data);
      setSideSheet(null);
      toast.success("Storage bin created.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Storage bin was not created. Check the form.");
    }
  };

  const handleUpdate = async (data: StorageLocationFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    try {
      await updateStorageLocation.mutateAsync({
        storageLocationId: sideSheet.entity.id,
        // The version the side sheet opened on, never a refetched one, so a
        // concurrent edit is refused instead of silently overwritten (#768).
        expectedUpdatedAt: sideSheet.entity.updatedAt,
        ...data,
      });
      setSideSheet(null);
      toast.success("Storage bin updated.");
    } catch (error) {
      // The side sheet stays open on every failure, so the operator's draft
      // survives an expected-version refusal untouched.
      setFormError(toSaveErrorMessage(error, "Storage bin was not saved. Try again."));
    }
  };

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

  const openCreate = () => {
    setFormError(null);
    setSideSheet({ mode: "create", entity: null });
  };

  const openView = (storageLocation: StorageLocationWithFacility) => {
    setFormError(null);
    setSideSheet({ mode: "view", entity: storageLocation });
  };

  const openEdit = (storageLocation: StorageLocationWithFacility) => {
    setFormError(null);
    setSideSheet({ mode: "edit", entity: storageLocation });
  };

  // Reconcile lives in its own side sheet — close the detail sheet first so the
  // two panels never stack.
  const openReconcile = (storageLocation: StorageLocationWithFacility, kind: "loss" | "count" = "count") => {
    setReconcileKind(kind);
    setSideSheet(null);
    setReconcilingBin(storageLocation);
  };

  const closeSideSheet = () => {
    setSideSheet(null);
    setFormError(null);
  };

  const handleModeChange = (mode: SideSheetMode) => {
    if (!sideSheet || !sideSheet.entity) return;
    setFormError(null);
    setSideSheet({ mode: mode === "edit" ? "edit" : "view", entity: sideSheet.entity });
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
  const editingEntity = sideSheet?.mode === "edit" ? sideSheet.entity : null;
  const isSubmitting = createStorageLocation.isPending || updateStorageLocation.isPending;

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

      <EntitySideSheet
        open={!!sideSheet}
        onOpenChange={(open) => {
          if (!open) closeSideSheet();
        }}
        mode={sideSheet?.mode ?? "create"}
        onModeChange={handleModeChange}
        // No detail toggle: a bin sheet has no explanation to switch on, since
        // a mix bin's batch shares are data and show at every level.
        // Bins lead with their name, not their code — the one entity where the
        // house convention (code as the sheet title) puts an opaque lookup key
        // where the operator's own word for the thing belongs. The code stays,
        // small, on the line beneath.
        title={sideSheet?.mode === "create" ? "Create storage bin" : sideSheet?.entity?.name ?? ""}
        subtitle={
          sideSheet?.mode === "create" ? undefined : sideSheet?.entity?.code
        }
        editLabel="Edit storage bin"
        canEdit={sideSheet?.entity?.archivedAt == null}
        sections={
          sideSheet?.mode === "view" && sideSheet.entity
            ? storageLocationSheetSections(sideSheet.entity, openReconcile)
            : undefined
        }
      >
        <StorageLocationForm
          key={editingEntity?.id ?? "create"}
          storageLocation={editingEntity as StorageLocation | undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
          errorMessage={formError ?? undefined}
          submitLabel={sideSheet?.mode === "edit" ? "Save changes" : "Create storage bin"}
        />
      </EntitySideSheet>

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
