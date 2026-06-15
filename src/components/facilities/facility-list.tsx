/**
 * FacilityList component
 * Visual facility overview with CRUD operations, filters, and card-based pagination
 */
"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  Factory,
  Lightning,
  MagnifyingGlass,
  Package,
  Plus,
  X,
} from "@phosphor-icons/react";
import type { Facility } from "@/db/schema";
import {
  useArchiveFacility,
  useCreateFacility,
  useFacilities,
  useFacilityCountries,
  useRestoreFacility,
  useUpdateFacility,
} from "@/hooks/use-facilities";
import { formatMass, getPaginationLabel } from "@/lib/format-utils";
import { ServerError } from "@/components/forms";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  FacilityCertifierLinkLoader,
  FacilityCertifierSummary,
} from "@/components/certification";
import { FacilityForm } from "./facility-form";
import { FacilityCard } from "./facility-card";
import { ArchiveFacilityDialog } from "./archive-facility-dialog";
import type { FacilityFormData, FacilityFilterData } from "@/schemas/facilities";
import type { FacilityWithRelations } from "@/data-access/facilities";

export function FacilityList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [sideSheet, setSideSheet] = useState<{
    entity: FacilityWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [archivingFacilityId, setArchivingFacilityId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  // After creating a facility, admins are offered the optional certifier link
  // for the new facility (skippable; editable later in Settings).
  const [linkCertifierFacilityId, setLinkCertifierFacilityId] = useState<
    string | null
  >(null);

  const isAdmin = useIsAdmin();
  const { setFacilityId } = useFacilityContext();

  const filters: Partial<FacilityFilterData> = useMemo(
    () => ({
      search: searchQuery || undefined,
      country: countryFilter || undefined,
      archived: showArchived,
      page: currentPage,
      pageSize,
      sortBy: "name",
      sortOrder: "asc",
    }),
    [searchQuery, countryFilter, showArchived, currentPage, pageSize]
  );

  const { data: facilitiesData, isLoading, error: fetchError } = useFacilities(filters);
  const { data: countries } = useFacilityCountries();

  const createFacility = useCreateFacility();
  const updateFacility = useUpdateFacility();
  const archiveFacility = useArchiveFacility();
  const restoreFacility = useRestoreFacility();
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
      const facility = await createFacility.mutateAsync(data);
      setFacilityId(facility.id);
      setSideSheet(null);
      toast.success("Facility created successfully");
      // Offer the optional certifier link for the new facility. Admin-only
      // (saving the mapping is admin-gated); non-admins create unlinked and an
      // admin links later in Settings.
      if (isAdmin) {
        setLinkCertifierFacilityId(facility.id);
      }
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

  const handleArchive = (facilityId: string) => setArchivingFacilityId(facilityId);

  const handleArchiveConfirm = async () => {
    if (!archivingFacilityId) return;
    setArchiveError(null);
    try {
      await archiveFacility.mutateAsync(archivingFacilityId);
      setArchivingFacilityId(null);
      toast.success("Facility archived — restore it any time from the archived view");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Failed to archive facility");
    }
  };

  const handleRestore = async (facilityId: string) => {
    setArchiveError(null);
    try {
      await restoreFacility.mutateAsync(facilityId);
      toast.success("Facility restored");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Failed to restore facility");
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

  const toggleShowArchived = () => {
    setShowArchived((previous) => !previous);
    setCurrentPage(1);
  };

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "Failed to load facilities"} />
      </div>
    );
  }

  // Derived values for the side sheet
  const sideSheetOpen = !!sideSheet;
  const sideSheetMode = sideSheet?.mode ?? "create";
  const sideSheetEntity = sideSheet?.entity ?? null;

  const sideSheetTitle =
    sideSheetMode === "create" ? "Create Facility" : sideSheetEntity?.code ?? "";

  const sideSheetSubtitle =
    sideSheetMode === "create" ? undefined : sideSheetEntity?.name;

  const sideSheetSections = sideSheetEntity
    ? [
        {
          title: "General Information",
          fields: [
            { label: "Code", value: sideSheetEntity.code },
            { label: "Name", value: sideSheetEntity.name },
            { label: "Location", value: sideSheetEntity.location },
            { label: "Country", value: sideSheetEntity.country },
            { label: "Address", value: sideSheetEntity.address },
          ],
        },
        {
          title: "Infrastructure",
          fields: [
            { label: "Reactors", value: `${sideSheetEntity.reactorCount} reactors` },
            {
              label: "Feedstock Bins",
              value: `${sideSheetEntity.storageSummary.feedstockBinCount} bins`,
            },
            {
              label: "Biochar Bins",
              value: `${sideSheetEntity.storageSummary.biocharBinCount} bins`,
            },
            {
              label: "Product Bins",
              value: `${sideSheetEntity.storageSummary.productBinCount} bins`,
            },
          ],
        },
        {
          title: "Inventory Snapshot",
          fields: [
            {
              label: "Feedstock On Hand",
              value: formatMass(sideSheetEntity.inventorySummary.feedstockDryKg),
            },
            {
              label: "Biochar On Hand",
              value: formatMass(sideSheetEntity.inventorySummary.biocharKg),
            },
            {
              label: "Product Mass",
              value: formatMass(sideSheetEntity.inventorySummary.productKg),
            },
          ],
        },
      ]
    : undefined;

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="infrastructure"
        title="Facilities"
        subtitle="Production sites, reactors, and registry links"
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={20} weight="bold" />
            New Facility
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title={showArchived ? "Archived Facilities" : "Active Facilities"}
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
            <Button
              variant={showArchived ? "primary" : "default"}
              size="small"
              onClick={toggleShowArchived}
              aria-pressed={showArchived}
            >
              <Archive size={16} weight="bold" />
              Archived
            </Button>

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
        <EmptyState
          padding="lg"
          icon={<Factory size={48} />}
          title={
            showArchived
              ? "No archived facilities"
              : hasActiveFilters
                ? "No facilities found"
                : "No facilities yet"
          }
          description={
            showArchived
              ? "Facilities you archive will appear here and can be restored."
              : hasActiveFilters
                ? "Try adjusting your search or filters."
                : "Create your first facility to start organising reactors and storage bins."
          }
          action={
            !hasActiveFilters && !showArchived ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus size={20} weight="bold" />
                Create Facility
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-24 xl:grid-cols-2 2xl:grid-cols-3">
            {facilities.map((facility) => (
              <FacilityCard
                key={facility.id}
                facility={facility}
                onView={openView}
                onEdit={openEdit}
                onArchive={handleArchive}
                onRestore={handleRestore}
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

      {archiveError && <ServerError message={archiveError} />}

      <ArchiveFacilityDialog
        facilityId={archivingFacilityId}
        onConfirm={handleArchiveConfirm}
        onCancel={() => {
          setArchivingFacilityId(null);
          setArchiveError(null);
        }}
        isPending={archiveFacility.isPending}
      />

      {/* Unified Side Sheet */}
      <EntitySideSheet
        open={sideSheetOpen}
        onOpenChange={(open) => !open && closeSideSheet()}
        mode={sideSheetMode}
        onModeChange={(mode) =>
          setSideSheet((previous) => (previous ? { ...previous, mode } : null))
        }
        title={sideSheetTitle}
        subtitle={sideSheetSubtitle}
        editLabel="Edit Facility"
        sections={sideSheetSections}
        viewModeChildren={
          sideSheetEntity ? (
            <FacilityCertifierSummary facilityId={sideSheetEntity.id} />
          ) : undefined
        }
      >
        {(createError || updateError) && (
          <div className="mb-24">
            <ServerError message={createError || updateError || ""} />
          </div>
        )}

        <FacilityForm
          key={sideSheetEntity?.id ?? "create"}
          facility={sideSheet?.entity as Facility | undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createFacility.isPending || updateFacility.isPending}
          submitLabel={sideSheetEntity && sideSheetMode === "edit" ? "Save Changes" : "Create Facility"}
        />
      </EntitySideSheet>

      {linkCertifierFacilityId && (
        <FacilityCertifierLinkLoader
          facilityId={linkCertifierFacilityId}
          isOpen
          onClose={() => setLinkCertifierFacilityId(null)}
        />
      )}
    </div>
  );
}
