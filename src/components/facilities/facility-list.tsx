/**
 * FacilityList component
 * Visual facility overview with CRUD operations, filters, and card-based pagination
 */
"use client";

import { useMemo, useState } from "react";
import {
  ArchiveIcon,
  FactoryIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Facility } from "@/db/schema";
import {
  useArchiveFacility,
  useCreateFacility,
  useFacilities,
  useFacilityCountries,
  useRestoreFacility,
  useUpdateFacility,
} from "@/hooks/use-facilities";
import { formatMass } from "@/lib/format-utils";
import { formatCount } from "@/lib/copy-utils";
import { ServerError } from "@/components/forms";
import {
  EntitySideSheet,
  type SideSheetMode,
} from "@/components/ui/entity-side-sheet";
import { StatCard } from "@/components/ui/stat-card";
import {
  Button,
  EmptyState,
  ListPagination,
  PageHeader,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useListPagination,
  useReconcileListPage,
} from "@/hooks/use-list-pagination";
import {
  FacilityCertifierLinkLoader,
  FacilityCertifierSummary,
} from "@/components/certification";
import { FacilityForm } from "./facility-form";
import { FacilityCard } from "./facility-card";
import { ArchiveFacilityDialog } from "./archive-facility-dialog";
import type { FacilityFormData, FacilityFilterData } from "@/schemas/facilities";
import type { FacilityWithRelations } from "@/data-access/facilities";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { formatDurabilityOption } from "@/schemas/credit-batches";
import { LIST_SEARCH_DEBOUNCE_MS } from "@/config/list-controls";
import { CardSkeleton } from "@/components/ui/loading-skeleton";

/** Placeholder cards shown while the first page of facilities loads. */
const LOADING_CARD_COUNT = 3;

export function FacilityList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const { currentPage, pageSize, setCurrentPage, setPageSize } =
    useListPagination(showArchived ? "archived" : "active");
  const debouncedSearch = useDebounce(
    searchQuery,
    LIST_SEARCH_DEBOUNCE_MS,
  );

  const [sideSheet, setSideSheet] = useState<{
    entity: FacilityWithRelations | null;
    mode: SideSheetMode;
  } | null>(null);
  const [archivingFacility, setArchivingFacility] = useState<{
    id: string;
    code: string;
    name: string;
  } | null>(null);
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
      search: debouncedSearch || undefined,
      country: countryFilter || undefined,
      archived: showArchived,
      page: currentPage,
      pageSize,
      sortBy: "name",
      sortOrder: "asc",
    }),
    [debouncedSearch, countryFilter, showArchived, currentPage, pageSize]
  );

  const { data: facilitiesData, isLoading, error: fetchError } = useFacilities(filters);
  // Country options follow the visible collection — the archived view offers
  // archived facilities' countries, not the active set's.
  const { data: countries } = useFacilityCountries(showArchived);

  const createFacility = useCreateFacility();
  const updateFacility = useUpdateFacility();
  const archiveFacility = useArchiveFacility();
  const restoreFacility = useRestoreFacility();
  const toast = useToast();

  const facilities = facilitiesData?.items ?? [];
  const totalFacilities = facilitiesData?.total ?? 0;
  const totalPages = facilitiesData?.totalPages ?? 0;
  useReconcileListPage({
    currentPage,
    totalPages,
    isLoading,
    setCurrentPage,
  });
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
      toast.success("Facility created.");
      // Offer the optional certifier link for the new facility. Admin-only
      // (saving the mapping is admin-gated); non-admins create unlinked and an
      // admin links later in Settings.
      if (isAdmin) {
        setLinkCertifierFacilityId(facility.id);
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Facility was not created. Check the form.");
    }
  };

  const handleUpdate = async (data: FacilityFormData) => {
    if (!sideSheet?.entity) return;
    setUpdateError(null);
    try {
      await updateFacility.mutateAsync({ facilityId: sideSheet.entity.id, ...data });
      setSideSheet(null);
      toast.success("Facility updated.");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Facility was not saved. Try again.");
    }
  };

  // The dialog needs the facility's identity (code + name), not just its id —
  // it names the target and gates populated archives on a typed code.
  const handleArchive = (facilityId: string) => {
    const target = facilities.find((f) => f.id === facilityId);
    setArchivingFacility(
      target ? { id: target.id, code: target.code, name: target.name } : null,
    );
  };

  const handleArchiveConfirm = async () => {
    if (!archivingFacility) return;
    setArchiveError(null);
    try {
      await archiveFacility.mutateAsync(archivingFacility.id);
      setArchivingFacility(null);
      toast.success("Facility archived. Restore it from the archived view.");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "The facility was not archived. Try again.");
    }
  };

  const handleRestore = async (facilityId: string) => {
    setArchiveError(null);
    try {
      await restoreFacility.mutateAsync(facilityId);
      toast.success("Facility restored");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "The facility was not restored. Try again.");
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
    // The two collections have independent country sets — a filter carried
    // across the toggle could silently hide every row.
    setCountryFilter("");
    setCurrentPage(1);
  };

  if (fetchError) {
    return (
      <div className="container-max py-32">
        <ServerError message={fetchError.message || "The facilities could not be loaded. Refresh the page and try again."} />
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
          title: "Facility information",
          fields: [
            { label: "Facility name", value: sideSheetEntity.name },
            { label: "Country", value: sideSheetEntity.country },
            { label: "Timezone", value: formatTimezoneLabel(sideSheetEntity.timezone) },
            { label: "Location", value: sideSheetEntity.location },
            { label: "Address", value: sideSheetEntity.address },
            { label: "Facility position latitude", value: sideSheetEntity.gpsLatitude },
            { label: "Facility position longitude", value: sideSheetEntity.gpsLongitude },
            { label: "Contact email", value: sideSheetEntity.contactEmail },
            { label: "Contact phone", value: sideSheetEntity.contactPhone },
            { label: "Durability tier", value: formatDurabilityOption(sideSheetEntity.durabilityOption) },
          ],
        },
        {
          title: "Infrastructure",
          fields: [
            {
              label: "Reactors",
              value: formatCount(sideSheetEntity.reactorCount, "reactor"),
            },
            {
              label: "Feedstock bins",
              value: formatCount(
                sideSheetEntity.storageSummary.feedstockBinCount,
                "bin",
              ),
            },
            {
              label: "Biochar bins",
              value: formatCount(
                sideSheetEntity.storageSummary.biocharBinCount,
                "bin",
              ),
            },
            {
              label: "Product bins",
              value: formatCount(
                sideSheetEntity.storageSummary.productBinCount,
                "bin",
              ),
            },
          ],
        },
        {
          title: "Inventory snapshot",
          fields: [
            {
              label: "Feedstock on hand",
              value: formatMass(sideSheetEntity.inventorySummary.feedstockDryKg),
            },
            {
              label: "Biochar on hand",
              value: formatMass(sideSheetEntity.inventorySummary.biocharKg),
            },
            {
              label: "Product mass",
              value: formatMass(sideSheetEntity.inventorySummary.productKg),
            },
          ],
        },
        {
          title: "Registry connection",
          fields: [],
          content: <FacilityCertifierSummary facilityId={sideSheetEntity.id} />,
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
            <PlusIcon size={20} weight="bold" />
            New Facility
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title={showArchived ? "Archived Facilities" : "Active Facilities"}
          value={totalFacilities}
          icon={<FactoryIcon size={24} weight="bold" />}
          description="Facilities matching the current filters"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Reactors"
          value={totalReactors}
          icon={<LightningIcon size={24} weight="bold" />}
          description="Installed across the visible facilities"
          isLoading={isLoading}
        />
        <StatCard
          title="Feedstock On Hand"
          value={formatMass(feedstockOnHandKg)}
          icon={<PackageIcon size={24} weight="bold" />}
          description={`${formatCount(totalStorageBins, "storage bin")} on this page`}
          isLoading={isLoading}
        />
      </div>

      <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="flex flex-col gap-16 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-12 md:grid-cols-[minmax(0,1fr)_200px]">
            <div className="relative">
              <MagnifyingGlassIcon
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
              aria-label="Filter facilities by country"
              value={countryFilter}
              onChange={(event) => {
                setCountryFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
            >
              <option value="">All countries</option>
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
          className="grid grid-cols-1 gap-24 xl:grid-cols-2 2xl:grid-cols-3"
          aria-busy="true"
        >
          <span className="sr-only">Loading facilities…</span>
          {Array.from({ length: LOADING_CARD_COUNT }).map((_, index) => (
            <CardSkeleton key={index} lines={3} />
          ))}
        </div>
      ) : facilities.length === 0 ? (
        <EmptyState
          padding="lg"
          icon={<FactoryIcon size={48} />}
          title={
            hasActiveFilters
              ? showArchived
                ? "No archived facilities match"
                : "No facilities found"
              : showArchived
                ? "No archived facilities"
                : "No facilities yet"
          }
          description={
            hasActiveFilters
              ? "Try adjusting your search or filters."
              : showArchived
                ? "Facilities you archive will appear here and can be restored."
                : "A facility is a production site, with its own reactors and storage bins."
          }
          action={
            !hasActiveFilters && !showArchived ? (
              <Button variant="primary" onClick={openCreate}>
                <PlusIcon size={20} weight="bold" />
                Create your first facility
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

      {archiveError && <ServerError message={archiveError} />}

      <ArchiveFacilityDialog
        facility={archivingFacility}
        onConfirm={handleArchiveConfirm}
        onCancel={() => {
          setArchivingFacility(null);
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
      >
        <FacilityForm
          key={sideSheetEntity?.id ?? "create"}
          facility={sideSheet?.entity as Facility | undefined}
          onSubmit={sideSheetEntity && sideSheetMode === "edit" ? handleUpdate : handleCreate}
          onCancel={closeSideSheet}
          isSubmitting={createFacility.isPending || updateFacility.isPending}
          errorMessage={createError || updateError || undefined}
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
