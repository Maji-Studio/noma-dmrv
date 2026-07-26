/**
 * StorageLocationList — a material-flow board. Bins are grouped into three
 * lanes ordered the way material moves through the facility
 * (Feedstock → Biochar → Product) and each bin is a silo tile whose gauge
 * shows what's still in it. The page is already facility-scoped, so the
 * facility is not repeated per bin.
 */
"use client";

import { useMemo, useState } from "react";
import {
  ArchiveIcon,
  ArrowsClockwiseIcon,
  CubeIcon,
  LeafIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlusIcon,
  WarehouseIcon,
  XIcon,
} from "@phosphor-icons/react";
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
import { formatDate, formatMass } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { ServerError } from "@/components/forms";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, ListPagination, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { StorageLocationForm } from "./storage-location-form";
import { StorageLocationCard } from "./storage-location-card";
import { BinReconcileSheet } from "./bin-reconcile-sheet";
import { BinMovementHistory } from "./bin-movement-history";
import { STORAGE_LANE_ORDER } from "./bin-display";
import {
  formatStorageLocationType,
  type StorageLocationFormData,
  type StorageLocationFilterData,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { CardSkeleton, Skeleton } from "@/components/ui/loading-skeleton";

/** Placeholder bin cards per lane while the first page of bins loads. */
const LOADING_CARDS_PER_LANE = 2;

const LANE_META: Record<
  StorageLocationType,
  { label: string; icon: React.ReactNode; accent: string; ink: string }
> = {
  feedstock_bin: {
    label: "Feedstock",
    icon: <LeafIcon size={18} weight="bold" />,
    accent: "var(--acc-prod)",
    ink: "var(--acc-prod-ink)",
  },
  biochar_bin: {
    label: "Biochar",
    icon: <CubeIcon size={18} weight="bold" />,
    accent: "var(--acc-infra)",
    ink: "var(--acc-infra-ink)",
  },
  product_bin: {
    label: "Product",
    icon: <PackageIcon size={18} weight="bold" />,
    accent: "var(--acc-dist)",
    ink: "var(--acc-dist-ink)",
  },
};

type SideSheetState =
  | { mode: "create"; entity: null }
  | { mode: "view"; entity: StorageLocationWithFacility }
  | { mode: "edit"; entity: StorageLocationWithFacility };

function formatDateOrFallback(value: Date | null) {
  if (!value) return "No completed applications";
  return formatDate(value);
}

function buildStorageDetailFields(storageLocation: StorageLocationWithFacility) {
  if (storageLocation.type === "feedstock_bin") {
    return [
      {
        label: "Current Dry Mass",
        value: formatMass(storageLocation.feedstockInventory.currentDryMassKg),
      },
      ...(storageLocation.feedstockInventory.pendingDryMassKg > 0
        ? [
            {
              label: "Pending Completion",
              value: formatMass(storageLocation.feedstockInventory.pendingDryMassKg),
            },
            {
              label: "Pending Feedstocks",
              value: String(storageLocation.feedstockInventory.pendingBatchCount),
            },
          ]
        : []),
      {
        label: "Estimated Wet Mass",
        value: storageLocation.feedstockInventory.estimatedWetMassKg
          ? formatMass(storageLocation.feedstockInventory.estimatedWetMassKg)
          : null,
      },
      {
        label: "Estimated Moisture",
        value: formatMoisturePercent(storageLocation.feedstockInventory.estimatedMoisturePercent),
      },
      {
        label: "Feedstock Types",
        value:
          storageLocation.feedstockInventory.feedstockTypes.join(", ") ||
          "No feedstock assigned",
      },
    ];
  }

  if (storageLocation.type === "biochar_bin") {
    return [
      {
        label: "Available Biochar",
        value: formatMass(storageLocation.biocharInventory.currentMassKg),
      },
      {
        label: "Allocated To Products",
        value: formatMass(storageLocation.biocharInventory.allocatedToProductsKg),
      },
      {
        label: "Production Runs",
        value: String(storageLocation.biocharInventory.productionRunCount),
      },
      {
        label: "Downstream Formulations",
        value:
          storageLocation.biocharInventory.downstreamFormulations.join(", ") ||
          "No linked formulations",
      },
    ];
  }

  return [
    {
      label: "Current Product Mass",
      value: formatMass(storageLocation.productInventory.currentMassKg),
    },
    {
      label: "Biochar Content",
      value: formatMass(storageLocation.productInventory.biocharEquivalentKg),
    },
    {
      label: "Product Batches",
      value: String(storageLocation.productInventory.batchCount),
    },
    {
      label: "Successfully Applied",
      value:
        storageLocation.productInventory.appliedApplicationCount > 0
          ? formatMass(storageLocation.productInventory.appliedDryMassKg)
          : "No completed applications",
    },
    {
      label: "Applied Events",
      value: String(storageLocation.productInventory.appliedApplicationCount),
    },
    {
      label: "Last Application",
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

  const filters: Partial<StorageLocationFilterData> = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      facilityId: facilityId || undefined,
      archived: showArchived,
      page: currentPage,
      pageSize,
      sortBy: "code",
      sortOrder: "asc",
    }),
    [debouncedSearch, facilityId, showArchived, currentPage, pageSize]
  );

  const { data: storageLocationsData, isLoading, error: fetchError } = useStorageLocations(filters, {
    enabled: !!facilityId,
  });

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

  // Group the current page into lanes in production-flow order. Facility-wide
  // counts and on-hand mass come from the server summary below.
  // (React Compiler memoizes these derivations — no manual useMemo.)
  const lanes = STORAGE_LANE_ORDER.map((type) => {
    const bins = storageLocations.filter((bin) => bin.type === type);
    return { type, bins };
  });

  const onHandByType: Record<StorageLocationType, number> = {
    feedstock_bin: laneSummary?.feedstock_bin.onHandKg ?? 0,
    biochar_bin: laneSummary?.biochar_bin.onHandKg ?? 0,
    product_bin: laneSummary?.product_bin.onHandKg ?? 0,
  };

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
      await updateStorageLocation.mutateAsync({
        storageLocationId: sideSheet.entity.id,
        ...data,
      });
      setSideSheet(null);
      toast.success("Storage location updated successfully");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to update storage location");
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
          : "Failed to archive storage location",
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
          : "Failed to restore storage location",
      );
    }
  };

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
    setCurrentPage(1);
  };

  const toggleShowArchived = () => {
    setShowArchived((current) => !current);
    setCurrentPage(1);
    setSideSheet(null);
  };

  const hasActiveFilters = Boolean(searchQuery);
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

      <div className="grid grid-cols-1 gap-24 md:grid-cols-3">
        <StatCard
          title="Feedstock On Hand"
          value={formatMass(onHandByType.feedstock_bin ?? 0)}
          icon={<LeafIcon size={24} weight="bold" color="var(--acc-prod)" />}
          description="Dry mass across facility bins"
          isLoading={isLoading}
        />
        <StatCard
          title="Biochar On Hand"
          value={formatMass(onHandByType.biochar_bin ?? 0)}
          icon={<CubeIcon size={24} weight="bold" color="var(--acc-infra)" />}
          description="Unallocated biochar across facility bins"
          isLoading={isLoading}
        />
        <StatCard
          title="Product On Hand"
          value={formatMass(onHandByType.product_bin ?? 0)}
          icon={<PackageIcon size={24} weight="bold" color="var(--acc-dist)" />}
          description="Packed product across facility bins"
          isLoading={isLoading}
        />
      </div>
      <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="flex flex-col gap-12 md:flex-row md:items-center md:justify-between">
          <div className="relative md:max-w-[360px] md:flex-1">
            <MagnifyingGlassIcon
              size={18}
              className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              type="text"
              placeholder="Search storage by code or name..."
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setCurrentPage(1);
              }}
              className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              aria-label="Search storage"
            />
          </div>

          <div className="flex items-center gap-12">
            <span className="body-small text-[var(--color-text-secondary)]">
              {totalStorageLocations}{" "}
              {totalStorageLocations === 1 ? "bin" : "bins"}
            </span>
            <Button
              variant={showArchived ? "primary" : "default"}
              size="small"
              onClick={toggleShowArchived}
              aria-pressed={showArchived}
            >
              <ArchiveIcon size={16} weight="bold" />
              Archived
            </Button>
            {hasActiveFilters && (
              <Button variant="noOutline" size="small" onClick={clearFilters}>
                <XIcon size={16} weight="bold" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </section>

      {isLoading ? (
        <div
          className="flex flex-col gap-32 lg:flex-row lg:items-start lg:gap-24"
          aria-busy="true"
        >
          <span className="sr-only">Loading storage bins…</span>
          {STORAGE_LANE_ORDER.map((type) => (
            <div key={type} className="flex flex-1 flex-col gap-16">
              <Skeleton className="h-24 w-[60%]" />
              {Array.from({ length: LOADING_CARDS_PER_LANE }).map((_, index) => (
                <CardSkeleton key={index} lines={2} />
              ))}
            </div>
          ))}
        </div>
      ) : storageLocations.length === 0 ? (
        <EmptyState
          padding="lg"
          icon={<WarehouseIcon size={48} />}
          title={
            hasActiveFilters
              ? showArchived
                ? "No archived storage bins match"
                : "No storage bins found"
              : showArchived
                ? "No archived storage bins"
                : "No storage bins yet"
          }
          description={
            hasActiveFilters
              ? "Try adjusting your search."
              : showArchived
                ? "Storage bins you archive will appear here and can be restored."
                : "Create your first storage bin to track feedstock, biochar, and finished product inventory."
          }
          action={
            !hasActiveFilters && !showArchived ? (
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={20} weight="bold" />
                Create Storage Bin
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-32 lg:flex-row lg:items-start lg:gap-24">
            {lanes.map((lane) => {
              const meta = LANE_META[lane.type];
              const facilityBinCount =
                laneSummary?.[lane.type].binCount ?? lane.bins.length;
              const facilityOnHandKg =
                laneSummary?.[lane.type].onHandKg ?? 0;
              return (
                <div key={lane.type} className="flex flex-1 flex-col gap-16">
                {/* Lane header */}
                <div
                  className="flex items-center justify-between gap-12 border-b-2 pb-10"
                  style={{ borderColor: meta.accent }}
                >
                  <div
                    className="flex items-center gap-8"
                    style={{ color: meta.ink }}
                  >
                    {meta.icon}
                    <span className="title-chapter-title">{meta.label}</span>
                    <span className="body-caption text-[var(--color-text-tertiary)]">
                      {lane.bins.length} on this page · {facilityBinCount} total
                    </span>
                  </div>
                  <span className="shrink-0 body-caption text-[var(--color-text-tertiary)]">
                    {formatMass(facilityOnHandKg)} on hand
                  </span>
                </div>

                {/* Bins */}
                {lane.bins.length === 0 ? (
                  <div className="flex items-center justify-center border border-dashed border-[var(--color-border-tertiary)] px-16 py-32 text-center body-caption text-[var(--color-text-tertiary)]">
                    No {meta.label.toLowerCase()} bins on this page
                  </div>
                ) : (
                  <div className="grid gap-16 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] lg:grid-cols-1">
                    {lane.bins.map((bin) => (
                      <StorageLocationCard
                        key={bin.id}
                        storageLocation={bin}
                        onView={openView}
                        onEdit={openEdit}
                        onArchive={handleArchive}
                        onRestore={handleRestore}
                        onDelete={handleDelete}
                        onReconcile={openReconcile}
                      />
                    ))}
                  </div>
                )}
                </div>
              );
            })}
          </div>
          <ListPagination
            page={currentPage}
            pageCount={totalPages}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            className="border-t border-[var(--color-border-tertiary)] pt-16 md:px-0"
          />
        </>
      )}

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
                  title: "Storage Details",
                  fields: [
                    {
                      label: "Storage Type",
                      value: formatStorageLocationType(sideSheet.entity.type),
                    },
                    { label: "Bin Name", value: sideSheet.entity.name },
                    {
                      // formatMass switches to tonnes at 1,000 kg — a unit
                      // suffix in the label would contradict the value.
                      label: "Capacity",
                      value: sideSheet.entity.capacityKg != null
                        ? formatMass(sideSheet.entity.capacityKg)
                        : null,
                    },
                    {
                      label: "Storage Method",
                      value: sideSheet.entity.storageMethod,
                    },
                    ...(sideSheet.entity.type === "feedstock_bin"
                      ? [{ label: "Feedstock Type", value: sideSheet.entity.feedstockTypeName }]
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
