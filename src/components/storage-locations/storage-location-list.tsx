/**
 * StorageLocationList — a material-flow board. Bins are grouped into three
 * lanes ordered the way material moves through the facility
 * (Feedstock → Biochar → Product) and each bin is a silo tile whose gauge
 * shows what's still in it. Replaces the old paginated card grid so 20+ bins
 * stay legible at a glance. The page is already facility-scoped, so the
 * facility is not repeated per bin.
 */
"use client";

import { useMemo, useState } from "react";
import {
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
  useCreateStorageLocation,
  useDeleteStorageLocation,
  useStorageLocations,
  useUpdateStorageLocation,
} from "@/hooks/use-storage-locations";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { formatDate, formatMass } from "@/lib/format-utils";
import { ServerError } from "@/components/forms";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { StorageLocationForm } from "./storage-location-form";
import { StorageLocationCard } from "./storage-location-card";
import { BinReconcileSheet } from "./bin-reconcile-sheet";
import { BinMovementHistory } from "./bin-movement-history";
import { STORAGE_LANE_ORDER, binCurrentMassKg } from "./bin-display";
import {
  formatStorageLocationType,
  type StorageLocationFormData,
  type StorageLocationFilterData,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";

// Bins per facility are few enough to load in one pass; the flow board groups
// them client-side rather than paging across the lanes.
const BIN_FETCH_LIMIT = 100;

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

function formatPercent(value: number | null) {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

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
        value: formatPercent(storageLocation.feedstockInventory.estimatedMoisturePercent),
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

  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [reconcilingBin, setReconcilingBin] =
    useState<StorageLocationWithFacility | null>(null);
  const [deletingStorageLocationId, setDeletingStorageLocationId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<StorageLocationFilterData> = useMemo(
    () => ({
      search: searchQuery || undefined,
      facilityId: facilityId || undefined,
      page: 1,
      pageSize: BIN_FETCH_LIMIT,
      sortBy: "code",
      sortOrder: "asc",
    }),
    [searchQuery, facilityId]
  );

  const { data: storageLocationsData, isLoading, error: fetchError } = useStorageLocations(filters, {
    enabled: !!facilityId,
  });

  const createStorageLocation = useCreateStorageLocation();
  const updateStorageLocation = useUpdateStorageLocation();
  const deleteStorageLocation = useDeleteStorageLocation();
  const toast = useToast();

  const storageLocations = storageLocationsData?.items ?? [];
  const totalStorageLocations = storageLocationsData?.total ?? 0;
  const isTruncated = totalStorageLocations > storageLocations.length;

  // Group into lanes in production-flow order, and tally on-hand mass per lane.
  // (React Compiler memoizes these derivations — no manual useMemo.)
  const lanes = STORAGE_LANE_ORDER.map((type) => {
    const bins = storageLocations.filter((bin) => bin.type === type);
    const onHandKg = bins.reduce((sum, bin) => sum + binCurrentMassKg(bin), 0);
    return { type, bins, onHandKg };
  });

  const onHandByType = Object.fromEntries(
    lanes.map((lane) => [lane.type, lane.onHandKg])
  ) as Record<StorageLocationType, number>;

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

  const clearFilters = () => setSearchQuery("");

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
          description={
            isTruncated
              ? "Loaded dry mass across feedstock bins"
              : "Dry mass across feedstock bins"
          }
          isLoading={isLoading}
        />
        <StatCard
          title="Biochar On Hand"
          value={formatMass(onHandByType.biochar_bin ?? 0)}
          icon={<CubeIcon size={24} weight="bold" color="var(--acc-infra)" />}
          description={
            isTruncated
              ? "Loaded unallocated biochar in store"
              : "Unallocated biochar in store"
          }
          isLoading={isLoading}
        />
        <StatCard
          title="Product On Hand"
          value={formatMass(onHandByType.product_bin ?? 0)}
          icon={<PackageIcon size={24} weight="bold" color="var(--acc-dist)" />}
          description={
            isTruncated
              ? "Loaded packed product ready to ship"
              : "Packed product ready to ship"
          }
          isLoading={isLoading}
        />
      </div>
      {isTruncated && (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Inventory totals and lane totals reflect the first {storageLocations.length} loaded bins.
        </p>
      )}

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
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              aria-label="Search storage"
            />
          </div>

          <div className="flex items-center gap-12">
            <span className="body-small text-[var(--color-text-secondary)]">
              {totalStorageLocations}{" "}
              {totalStorageLocations === 1 ? "bin" : "bins"}
              {isTruncated ? ` · showing first ${storageLocations.length}` : ""}
            </span>
            {hasActiveFilters && (
              <Button variant="noOutline" size="small" onClick={clearFilters}>
                <XIcon size={16} weight="bold" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </section>

      {storageLocations.length === 0 ? (
        <EmptyState
          padding="lg"
          icon={<WarehouseIcon size={48} />}
          title={hasActiveFilters ? "No storage bins found" : "No storage bins yet"}
          description={
            hasActiveFilters
              ? "Try adjusting your search."
              : "Create your first storage bin to track feedstock, biochar, and finished product inventory."
          }
          action={
            !hasActiveFilters ? (
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={20} weight="bold" />
                Create Storage Bin
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-32 lg:flex-row lg:items-start lg:gap-24">
          {lanes.map((lane) => {
            const meta = LANE_META[lane.type];
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
                      {lane.bins.length}{" "}
                      {lane.bins.length === 1 ? "bin" : "bins"}
                    </span>
                  </div>
                  <span className="shrink-0 body-caption text-[var(--color-text-tertiary)]">
                    {formatMass(lane.onHandKg)} {isTruncated ? "loaded" : ""} on hand
                  </span>
                </div>

                {/* Bins */}
                {lane.bins.length === 0 ? (
                  <div className="flex items-center justify-center border border-dashed border-[var(--color-border-tertiary)] px-16 py-32 text-center body-caption text-[var(--color-text-tertiary)]">
                    No {meta.label.toLowerCase()} bins
                  </div>
                ) : (
                  <div className="grid gap-16 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] lg:grid-cols-1">
                    {lane.bins.map((bin) => (
                      <StorageLocationCard
                        key={bin.id}
                        storageLocation={bin}
                        onView={openView}
                        onEdit={openEdit}
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
      )}

      {deleteError && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deletingStorageLocationId}
        title="Delete Storage Bin"
        message="Are you sure you want to delete this storage bin? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingStorageLocationId(null);
          setDeleteError(null);
        }}
        isPending={deleteStorageLocation.isPending}
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
                },
                {
                  title: "Record Metadata",
                  fields: [
                    { label: "Code", value: sideSheet.entity.code },
                    { label: "Facility", value: sideSheet.entity.facilityName },
                  ],
                },
              ]
            : undefined
        }
        viewModeChildren={
          sideSheet?.mode === "view" && sideSheet.entity ? (
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
          ) : undefined
        }
      >
        {formError && (
          <div className="mb-24">
            <ServerError message={formError} />
          </div>
        )}

        <StorageLocationForm
          key={editingEntity?.id ?? "create"}
          storageLocation={editingEntity as StorageLocation | undefined}
          onSubmit={sideSheet?.mode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={isSubmitting}
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
