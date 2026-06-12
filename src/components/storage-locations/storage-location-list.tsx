/**
 * StorageLocationList component
 * Visual storage overview with type-aware inventory cards and CRUD operations
 */
"use client";

import { useMemo, useState } from "react";
import {
  Cube,
  MagnifyingGlass,
  Package,
  Plus,
  Warehouse,
  X,
} from "@phosphor-icons/react";
import type { StorageLocation } from "@/db/schema";
import {
  useCreateStorageLocation,
  useDeleteStorageLocation,
  useStorageLocations,
  useUpdateStorageLocation,
} from "@/hooks/use-storage-locations";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatMass, formatSafeDate, getPaginationLabel } from "@/lib/format-utils";
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
import {
  formatStorageLocationType,
  type StorageLocationFormData,
  type StorageLocationFilterData,
} from "@/schemas/storage-locations";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";

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
  return formatSafeDate(value);
}

function buildStorageDetailFields(storageLocation: StorageLocationWithFacility) {
  if (storageLocation.type === "feedstock_bin") {
    return [
      {
        label: "Current Dry Mass",
        value: formatMass(storageLocation.feedstockInventory.currentDryMassKg),
      },
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
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [sideSheet, setSideSheet] = useState<SideSheetState | null>(null);
  const [deletingStorageLocationId, setDeletingStorageLocationId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filterKey = `${facilityId ?? ""}-${typeFilter}-${searchQuery}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    if (currentPage !== 1) setCurrentPage(1);
  }

  const effectivePage = filterKey !== lastFilterKey ? 1 : currentPage;

  const filters: Partial<StorageLocationFilterData> = useMemo(
    () => ({
      search: searchQuery || undefined,
      facilityId: facilityId || undefined,
      type: (typeFilter as StorageLocationFilterData["type"]) || undefined,
      page: effectivePage,
      pageSize,
      sortBy: "code",
      sortOrder: "asc",
    }),
    [searchQuery, facilityId, typeFilter, effectivePage, pageSize]
  );

  const { data: storageLocationsData, isLoading, error: fetchError } = useStorageLocations(filters);

  const createStorageLocation = useCreateStorageLocation();
  const updateStorageLocation = useUpdateStorageLocation();
  const deleteStorageLocation = useDeleteStorageLocation();
  const toast = useToast();

  const storageLocations = storageLocationsData?.items ?? [];
  const totalStorageLocations = storageLocationsData?.total ?? 0;
  const totalPages = storageLocationsData?.totalPages ?? 0;
  const pageCapacity = storageLocations.reduce(
    (sum, storageLocation) => sum + (storageLocation.capacityKg ?? 0),
    0
  );
  const feedstockDryKg = storageLocations.reduce(
    (sum, storageLocation) => sum + storageLocation.feedstockInventory.currentDryMassKg,
    0
  );
  const activeStorageCount = storageLocations.filter((storageLocation) => {
    if (storageLocation.type === "feedstock_bin") {
      return storageLocation.feedstockInventory.currentDryMassKg > 0;
    }

    if (storageLocation.type === "biochar_bin") {
      return storageLocation.biocharInventory.currentMassKg > 0;
    }

    return storageLocation.productInventory.currentMassKg > 0;
  }).length;

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
    setTypeFilter("");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(searchQuery || typeFilter);
  const editingEntity = sideSheet?.mode === "edit" ? sideSheet.entity : null;
  const isSubmitting = createStorageLocation.isPending || updateStorageLocation.isPending;

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load storage"} />
      </div>
    );
  }

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <PageHeader
        area="infrastructure"
        title="Storage"
        subtitle="Bins and stores for feedstock and biochar"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={20} weight="bold" />
            New Storage Bin
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Storage Bins"
          value={totalStorageLocations}
          icon={<Warehouse size={24} weight="bold" />}
          description="Bins matching the current filters"
          isLoading={isLoading}
        />
        <StatCard
          title="Feedstock On Hand"
          value={formatMass(feedstockDryKg)}
          icon={<Package size={24} weight="bold" />}
          description="Dry-mass view across visible feedstock bins"
          isLoading={isLoading}
        />
        <StatCard
          title="Used Bins"
          value={activeStorageCount}
          icon={<Cube size={24} weight="bold" />}
          description={`Combined capacity ${formatMass(pageCapacity)}`}
          isLoading={isLoading}
        />
      </div>

      <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="flex flex-col gap-16 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-12 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative">
              <MagnifyingGlass
                size={18}
                className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                type="text"
                placeholder="Search storage..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                aria-label="Search storage"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
            >
              <option value="">All Storage Types</option>
              <option value="feedstock_bin">Feedstock Bin</option>
              <option value="biochar_bin">Biochar Bin</option>
              <option value="product_bin">Product Bin</option>
              <option value="ingredient_bin">Ingredient Bin</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-8">
            <select
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
              aria-label="Storage bins per page"
            >
              <option value="12">12 per page</option>
              <option value="24">24 per page</option>
              <option value="36">36 per page</option>
            </select>

            {hasActiveFilters && (
              <Button variant="noOutline" size="small" onClick={clearFilters}>
                <X size={16} weight="bold" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </section>

      {storageLocations.length === 0 ? (
        <EmptyState
          padding="lg"
          icon={<Warehouse size={48} />}
          title={hasActiveFilters ? "No storage bins found" : "No storage bins yet"}
          description={
            hasActiveFilters
              ? "Try adjusting your search or storage-type filter."
              : "Create your first storage bin to track feedstock, biochar, and finished product inventory."
          }
          action={
            !hasActiveFilters ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus size={20} weight="bold" />
                Create Storage Bin
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-24 xl:grid-cols-2 2xl:grid-cols-3">
            {storageLocations.map((storageLocation) => (
              <StorageLocationCard
                key={storageLocation.id}
                storageLocation={storageLocation}
                onView={openView}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>

          <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-16 md:flex-row md:items-center md:justify-between">
            <p className="body-small text-[var(--color-text-secondary)]">
              {getPaginationLabel(currentPage, pageSize, totalStorageLocations, "storage bins")}
            </p>

            <div className="flex items-center gap-8">
              <Button
                variant="default"
                size="small"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <span className="px-8 body-small text-[var(--color-text-secondary)]">
                Page {currentPage} of {Math.max(totalPages, 1)}
              </span>
              <Button
                variant="default"
                size="small"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
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
                  title: "Overview",
                  fields: [
                    { label: "Code", value: sideSheet.entity.code },
                    { label: "Name", value: sideSheet.entity.name },
                    {
                      label: "Type",
                      value: formatStorageLocationType(sideSheet.entity.type),
                    },
                    {
                      label: "Capacity",
                      value: sideSheet.entity.capacityKg
                        ? formatMass(sideSheet.entity.capacityKg)
                        : null,
                    },
                    {
                      label: "Storage Method",
                      value: sideSheet.entity.storageMethod,
                    },
                  ],
                },
                {
                  title: "Inventory",
                  fields: buildStorageDetailFields(sideSheet.entity),
                },
                {
                  title: "Facility",
                  fields: [
                    { label: "Facility Name", value: sideSheet.entity.facilityName },
                    { label: "Facility Code", value: sideSheet.entity.facilityCode },
                  ],
                },
              ]
            : undefined
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
    </div>
  );
}
