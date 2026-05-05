/**
 * FacilityList component
 * Visual facility overview with CRUD operations, filters, and card-based pagination
 */
"use client";

import { useMemo, useState } from "react";
import {
  Factory,
  Lightning,
  MagnifyingGlass,
  Package,
  Plus,
  X,
} from "@phosphor-icons/react";
import type { Facility } from "@/db/schema";
import {
  useCreateFacility,
  useDeleteFacility,
  useFacilities,
  useFacilityCountries,
  useUpdateFacility,
} from "@/hooks/use-facilities";
import { formatMass, getPaginationLabel } from "@/lib/format-utils";
import { ServerError } from "@/components/forms";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { FacilityCertifierSection } from "@/components/certification";
import { FacilityForm } from "./facility-form";
import { FacilityCard } from "./facility-card";
import type { FacilityFormData, FacilityFilterData } from "@/schemas/facilities";
import type { FacilityWithRelations } from "@/data-access/facilities";

export function FacilityList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [sideSheet, setSideSheet] = useState<{
    entity: FacilityWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [deletingFacilityId, setDeletingFacilityId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filters: Partial<FacilityFilterData> = useMemo(
    () => ({
      search: searchQuery || undefined,
      country: countryFilter || undefined,
      page: currentPage,
      pageSize,
      sortBy: "name",
      sortOrder: "asc",
    }),
    [searchQuery, countryFilter, currentPage, pageSize]
  );

  const { data: facilitiesData, isLoading, error: fetchError } = useFacilities(filters);
  const { data: countries } = useFacilityCountries();

  const createFacility = useCreateFacility();
  const updateFacility = useUpdateFacility();
  const deleteFacility = useDeleteFacility();
  const toast = useToast();

  const facilities = facilitiesData?.items ?? [];
  const totalFacilities = facilitiesData?.total ?? 0;
  const totalPages = facilitiesData?.totalPages ?? 0;
  const totalReactors = facilities.reduce((sum, facility) => sum + facility.reactorCount, 0);
  const totalStorageBins = facilities.reduce(
    (sum, facility) => sum + facility.storageLocationCount,
    0
  );
  const feedstockOnHandKg = facilities.reduce(
    (sum, facility) => sum + facility.inventorySummary.feedstockDryKg,
    0
  );

  const handleCreate = async (data: FacilityFormData) => {
    setCreateError(null);
    try {
      await createFacility.mutateAsync(data);
      setSideSheet(null);
      toast.success("Facility created successfully");
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
      toast.success("Facility updated successfully");
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
      toast.success("Facility deleted successfully");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete facility");
    }
  };

  const openCreate = () => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: null, mode: "create" });
  };

  const openView = (facility: FacilityWithRelations) => {
    setSideSheet({ entity: facility, mode: "view" });
  };

  const openEdit = (facility: FacilityWithRelations) => {
    setCreateError(null);
    setUpdateError(null);
    setSideSheet({ entity: facility, mode: "edit" });
  };

  const closeSideSheet = () => {
    setSideSheet(null);
    setCreateError(null);
    setUpdateError(null);
  };
  useOpenCreateIntent(openCreate);

  const clearFilters = () => {
    setSearchQuery("");
    setCountryFilter("");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(searchQuery || countryFilter);

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load facilities"} />
      </div>
    );
  }

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <div className="flex items-center justify-between gap-24">
        <h1 className="title-heading-2">Facilities</h1>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={20} weight="bold" />
          New Facility
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Active Facilities"
          value={totalFacilities}
          icon={<Factory size={24} weight="bold" />}
          description="Facilities matching the current filters"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Reactors"
          value={totalReactors}
          icon={<Lightning size={24} weight="bold" />}
          description="Installed across the visible facilities"
          isLoading={isLoading}
        />
        <StatCard
          title="Feedstock On Hand"
          value={formatMass(feedstockOnHandKg)}
          icon={<Package size={24} weight="bold" />}
          description={`${totalStorageBins} storage bins on this page`}
          isLoading={isLoading}
        />
      </div>

      <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="flex flex-col gap-16 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-12 md:grid-cols-[minmax(0,1fr)_200px]">
            <div className="relative">
              <MagnifyingGlass
                size={18}
                className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                type="text"
                placeholder="Search facilities..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                aria-label="Search facilities"
              />
            </div>

            <select
              value={countryFilter}
              onChange={(event) => {
                setCountryFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
            >
              <option value="">All Countries</option>
              {countries?.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
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
              aria-label="Facilities per page"
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

      {facilities.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-24 border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-white)] py-56">
          <Factory size={48} className="text-[var(--color-text-tertiary)]" />
          <div className="text-center">
            <h3 className="title-heading-3 mb-8">
              {hasActiveFilters ? "No facilities found" : "No facilities yet"}
            </h3>
            <p className="body-small text-[var(--color-text-secondary)]">
              {hasActiveFilters
                ? "Try adjusting your search or filters."
                : "Create your first facility to start organising reactors and storage bins."}
            </p>
          </div>
          {!hasActiveFilters && (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={20} weight="bold" />
              Create Facility
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-24 xl:grid-cols-2 2xl:grid-cols-3">
            {facilities.map((facility) => (
              <FacilityCard
                key={facility.id}
                facility={facility}
                onView={openView}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>

          <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-16 md:flex-row md:items-center md:justify-between">
            <p className="body-small text-[var(--color-text-secondary)]">
              {getPaginationLabel(currentPage, pageSize, totalFacilities, "facilities")}
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
        isOpen={!!deletingFacilityId}
        title="Delete Facility"
        message="Are you sure you want to delete this facility? This action cannot be undone. Note: Facilities with reactors or storage locations cannot be deleted."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingFacilityId(null);
          setDeleteError(null);
        }}
        isPending={deleteFacility.isPending}
      />

      {sideSheet && (
        <EntitySideSheet
          open
          onOpenChange={(open) => !open && closeSideSheet()}
          mode={sideSheet.mode}
          onModeChange={(mode) =>
            setSideSheet((previous) => (previous ? { ...previous, mode } : null))
          }
          title={sideSheet.mode === "create" ? "Create Facility" : sideSheet.entity?.code ?? ""}
          subtitle={
            sideSheet.mode === "create"
              ? "Fill in the form to create a new facility."
              : sideSheet.entity?.name
          }
          editLabel="Edit Facility"
          sections={
            sideSheet.entity
              ? [
                  {
                    title: "General Information",
                    fields: [
                      { label: "Code", value: sideSheet.entity.code },
                      { label: "Name", value: sideSheet.entity.name },
                      { label: "Location", value: sideSheet.entity.location },
                      { label: "Country", value: sideSheet.entity.country },
                      { label: "Address", value: sideSheet.entity.address },
                    ],
                  },
                  {
                    title: "Infrastructure",
                    fields: [
                      { label: "Reactors", value: `${sideSheet.entity.reactorCount} reactors` },
                      {
                        label: "Feedstock Bins",
                        value: `${sideSheet.entity.storageSummary.feedstockBinCount} bins`,
                      },
                      {
                        label: "Biochar Bins",
                        value: `${sideSheet.entity.storageSummary.biocharBinCount} bins`,
                      },
                      {
                        label: "Product Bins",
                        value: `${sideSheet.entity.storageSummary.productBinCount} bins`,
                      },
                    ],
                  },
                  {
                    title: "Inventory Snapshot",
                    fields: [
                      {
                        label: "Feedstock On Hand",
                        value: formatMass(sideSheet.entity.inventorySummary.feedstockDryKg),
                      },
                      {
                        label: "Biochar On Hand",
                        value: formatMass(sideSheet.entity.inventorySummary.biocharKg),
                      },
                      {
                        label: "Product Mass",
                        value: formatMass(sideSheet.entity.inventorySummary.productKg),
                      },
                    ],
                  },
                ]
              : undefined
          }
          viewModeChildren={
            sideSheet.entity ? (
              <FacilityCertifierSection facilityId={sideSheet.entity.id} />
            ) : undefined
          }
        >
          {(createError || updateError) && (
            <div className="mb-24">
              <ServerError message={createError || updateError || ""} />
            </div>
          )}

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
