/**
 * StorageLocationList — page state and side sheets for the storage board.
 *
 * The board itself (control rail + silo tiles) lives in `storage-bin-board.tsx`;
 * this file owns the query, the filter/sort state it derives, and the three
 * panels a bin can open: detail, reconcile, and delete confirmation. The page is
 * already facility-scoped, so the facility is not repeated per bin.
 */
"use client";

import { useMemo, useState } from "react";
import { ArrowsClockwiseIcon, PlusIcon } from "@phosphor-icons/react";
import type { StorageLocation } from "@/db/schema";
import {
  useArchiveStorageLocation,
  useCreateStorageLocation,
  useDeleteStorageLocation,
  useRestoreStorageLocation,
  useStorageLocations,
  useUpdateStorageLocation,
} from "@/hooks/use-storage-locations";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { ServerError } from "@/components/forms";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { StorageLocationForm } from "./storage-location-form";
import { StorageBinBoard } from "./storage-bin-board";
import { BinReconcileSheet } from "./bin-reconcile-sheet";
import { BinMovementHistory } from "./bin-movement-history";
import {
  DEFAULT_BIN_SORT,
  parseBinSortValue,
  type StorageBinTypeFilter,
} from "./bin-display";
import {
  formatStorageLocationType,
  type StorageLocationFormData,
  type StorageLocationFilterData,
} from "@/schemas/storage-locations";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: StorageLocationWithFacility }
  | { mode: "edit"; entity: StorageLocationWithFacility };

function formatDateOrFallback(value: Date | null) {
  if (!value) return "No completed applications";
  return formatDate(value);
}

/**
 * Per-bin figures are fixed kg (`formatMassKg`) on every branch and in the card
 * that opens this sheet — capacity, stock, allocations and movement deltas are
 * read against each other, and auto-tonne would round a wet/dry pair to the
 * same string. Facility-wide roll-ups (the KPI strip, the lane headers) stay on
 * auto-tonne `formatMass`.
 */
function buildStorageDetailFields(storageLocation: StorageLocationWithFacility) {
  if (storageLocation.type === "feedstock_bin") {
    return [
      {
        label: "Current dry mass",
        value: formatMassKg(storageLocation.feedstockInventory.currentDryMassKg),
      },
      ...(storageLocation.feedstockInventory.pendingDryMassKg > 0
        ? [
            {
              label: "Pending completion",
              value: formatMassKg(storageLocation.feedstockInventory.pendingDryMassKg),
            },
            {
              label: "Pending feedstocks",
              value: String(storageLocation.feedstockInventory.pendingBatchCount),
            },
          ]
        : []),
      {
        label: "Estimated wet mass",
        value: formatMassKg(storageLocation.feedstockInventory.estimatedWetMassKg),
      },
      {
        label: "Estimated moisture",
        value: formatMoisturePercent(storageLocation.feedstockInventory.estimatedMoisturePercent),
      },
      {
        label: "Feedstock types",
        value:
          storageLocation.feedstockInventory.feedstockTypes.join(", ") ||
          "No feedstock assigned",
      },
    ];
  }

  if (storageLocation.type === "biochar_bin") {
    return [
      {
        label: "Available biochar",
        value: formatMassKg(storageLocation.biocharInventory.currentMassKg),
      },
      {
        label: "Allocated to products",
        value: formatMassKg(storageLocation.biocharInventory.allocatedToProductsKg),
      },
      {
        label: "Production runs",
        value: String(storageLocation.biocharInventory.productionRunCount),
      },
      {
        label: "Downstream formulations",
        value:
          storageLocation.biocharInventory.downstreamFormulations.join(", ") ||
          "No linked formulations",
      },
    ];
  }

  return [
    {
      label: "Current product mass",
      value: formatMassKg(storageLocation.productInventory.currentMassKg),
    },
    {
      label: "Biochar content",
      value: formatMassKg(storageLocation.productInventory.biocharEquivalentKg),
    },
    {
      label: "Product batches",
      value: String(storageLocation.productInventory.batchCount),
    },
    {
      // Dry basis, unlike the as-is masses above it — the label has to say so.
      label: "Applied, dry",
      value:
        storageLocation.productInventory.appliedApplicationCount > 0
          ? formatMassKg(storageLocation.productInventory.appliedDryMassKg)
          : "No completed applications",
    },
    {
      label: "Applied events",
      value: String(storageLocation.productInventory.appliedApplicationCount),
    },
    {
      label: "Last application",
      value: formatDateOrFallback(storageLocation.productInventory.lastAppliedAt),
    },
    {
      label: "Formulations",
      value:
        storageLocation.productInventory.formulationNames.join(", ") ||
        "No products assigned",
    },
  ];
}

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
  const [reconcilingBin, setReconcilingBin] =
    useState<StorageLocationWithFacility | null>(null);
  const [deletingStorageLocationId, setDeletingStorageLocationId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sort = parseBinSortValue(sortValue);
  const filters: Partial<StorageLocationFilterData> = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      facilityId: facilityId || undefined,
      type: typeFilter !== "all" ? typeFilter : undefined,
      archived: showArchived,
      page: currentPage,
      pageSize,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    }),
    [
      debouncedSearch,
      facilityId,
      typeFilter,
      showArchived,
      currentPage,
      pageSize,
      sort.sortBy,
      sort.sortOrder,
    ]
  );

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
      toast.success("Storage bin created successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to create storage bin");
    }
  };

  const handleUpdate = async (data: StorageLocationFormData) => {
    if (sideSheet?.mode !== "edit") return;
    setFormError(null);
    try {
      await updateStorageLocation.mutateAsync({
        storageLocationId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
      toast.success("Storage bin updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update storage bin");
    }
  };

  const handleDelete = (id: string) => setDeletingStorageLocationId(id);

  const handleArchive = async (storageLocationId: string) => {
    setDeleteError(null);
    try {
      await archiveStorageLocation.mutateAsync(storageLocationId);
      toast.success(
        "Storage bin archived — restore it any time from the archived view",
      );
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Failed to archive storage bin",
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
          : "Failed to restore storage bin",
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingStorageLocationId) return;
    setDeleteError(null);
    try {
      await deleteStorageLocation.mutateAsync(deletingStorageLocationId);
      setDeletingStorageLocationId(null);
      toast.success("Storage bin deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete storage bin");
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
  const openReconcile = (storageLocation: StorageLocationWithFacility) => {
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
        <ServerError message={fetchError.message || "Failed to load storage"} />
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
            New Storage Bin
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
      />

      {deleteError && !deletingStorageLocationId && (
        <ServerError message={deleteError} />
      )}

      <DeleteConfirmDialog
        isOpen={!!deletingStorageLocationId}
        title="Delete Storage Bin"
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
        title={sideSheet?.mode === "create" ? "Create Storage Bin" : sideSheet?.entity?.code ?? ""}
        subtitle={
          sideSheet?.mode === "create" ? undefined : sideSheet?.entity?.name
        }
        editLabel="Edit Storage Bin"
        canEdit={sideSheet?.entity?.archivedAt == null}
        sections={
          sideSheet?.mode === "view" && sideSheet.entity
            ? [
                {
                  title: "Storage details",
                  fields: [
                    {
                      label: "Storage type",
                      value: formatStorageLocationType(sideSheet.entity.type),
                    },
                    { label: "Bin name", value: sideSheet.entity.name },
                    {
                      // Capacity and the current mass below it are the canonical
                      // related pair — same formatter, so "1,800 kg of 2,500 kg"
                      // never reads as "1,800 kg of 2.5 t".
                      label: "Capacity",
                      value: sideSheet.entity.capacityKg != null
                        ? formatMassKg(sideSheet.entity.capacityKg)
                        : null,
                    },
                    {
                      label: "Storage method",
                      value: sideSheet.entity.storageMethod,
                    },
                    ...(sideSheet.entity.type === "feedstock_bin"
                      ? [{ label: "Feedstock type", value: sideSheet.entity.feedstockTypeName }]
                      : []),
                    ...(sideSheet.entity.type === "product_bin"
                      ? [{ label: "Formulation", value: sideSheet.entity.formulationName }]
                      : []),
                    { label: "Description", value: sideSheet.entity.storageDescription },
                  ],
                },
                {
                  title: "Inventory",
                  fields: buildStorageDetailFields(sideSheet.entity),
                  content: (
                    <div className="flex flex-col gap-16">
                      <Button
                        variant="default"
                        onClick={() => openReconcile(sideSheet.entity)}
                      >
                        <ArrowsClockwiseIcon size={18} weight="bold" />
                        Reconcile stock
                      </Button>
                      <BinMovementHistory storageLocationId={sideSheet.entity.id} />
                    </div>
                  ),
                },
              ]
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
          submitLabel={sideSheet?.mode === "edit" ? "Save Changes" : "Create Storage Bin"}
        />
      </EntitySideSheet>

      <BinReconcileSheet
        open={!!reconcilingBin}
        onOpenChange={(open) => {
          if (!open) setReconcilingBin(null);
        }}
        storageLocation={reconcilingBin}
      />
    </div>
  );
}
