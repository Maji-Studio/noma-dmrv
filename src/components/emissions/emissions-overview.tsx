/**
 * EmissionsOverview: the /emissions page (epic #1058). KPI strip (each card
 * applies its state filter) → toolbar (search, state, period, sort on
 * phones) → credit batches × line states table → the facility's recorded
 * activity behind the "Facility activity" disclosure. Filter, sort and the
 * disclosure live in the URL (#841, emissions-overview-query.ts).
 */
"use client";

import { parseAsBoolean, useQueryState } from "nuqs";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { FacilityActivity } from "@/components/energy";
import { ServerError } from "@/components/forms";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { PageHeader } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useEmissionsOverview } from "@/hooks/use-emissions-overview";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { FilteredEmpty, NoBatchesEmpty } from "./emissions-overview-empty";
import { EmissionsOverviewKpis } from "./emissions-overview-kpis";
import { facetBatches, filterAndSortBatches, useEmissionsOverviewQuery } from "./emissions-overview-query";
import { EmissionsOverviewTable } from "./emissions-overview-table";
import { EmissionsOverviewToolbar } from "./emissions-overview-toolbar";

const TITLE = "Emissions";
const SUBTITLE = "Every line your credit batches' Removal templates ask for.";
const ACTIVITY_TITLE = "Facility activity";
const ACTIVITY_CAPTION = "Includes manual entries on fuel and electricity lines.";
const ACTIVITY_REGION_ID = "facility-activity";
const TABLE_SKELETON_CLASS = "h-320 w-full";
const PANEL_CLASS = "[border:var(--panel-border)] bg-[var(--paper)]";

interface EmissionsOverviewProps {
  /** The server's EMISSIONS_ENTRIES_ENABLED flag. Off, manual entries count nowhere, so the activity caption is left out. */
  entriesEnabled: boolean;
}

export function EmissionsOverview({ entriesEnabled }: EmissionsOverviewProps) {
  const { facilityId } = useFacilityContext();

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader area="infrastructure" title={TITLE} subtitle={SUBTITLE} />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to see its emissions." />
      </div>
    );
  }

  return <EmissionsLedger facilityId={facilityId} entriesEnabled={entriesEnabled} />;
}

function EmissionsLedger({ facilityId, entriesEnabled }: { facilityId: string; entriesEnabled: boolean }) {
  const { data, isLoading, error } = useEmissionsOverview(facilityId);
  const { query, setQuery, toggleSort, clear, hasFilters } = useEmissionsOverviewQuery();
  const [activityOpen, setActivityOpen] = useQueryState(
    "activity",
    parseAsBoolean.withDefault(false).withOptions({ history: "replace", scroll: false }),
  );

  if (error && !data) {
    return (
      <div className="container-max py-32">
        <ServerError message={error.message || "The emissions overview could not be loaded. Refresh the page and try again."} />
      </div>
    );
  }

  const batches = data?.batches ?? [];
  const facet = facetBatches(batches, query);
  const rows = filterAndSortBatches(batches, query);

  return (
    <div className="container-max page-shell">
      <PageHeader area="infrastructure" title={TITLE} subtitle={SUBTITLE} />
      <EmissionsOverviewKpis facet={facet} query={query} facilityId={facilityId} isLoading={isLoading} />

      <div className={PANEL_CLASS}>
        {isLoading || !data ? (
          <div className="p-16">
            <Skeleton className={TABLE_SKELETON_CLASS} />
          </div>
        ) : batches.length === 0 ? (
          <div className="p-16">
            <NoBatchesEmpty />
          </div>
        ) : (
          <>
            <EmissionsOverviewToolbar
              query={query}
              setQuery={setQuery}
              hasFilters={hasFilters}
              onClear={clear}
              shown={rows.length}
              total={batches.length}
            />
            {rows.length === 0 ? (
              <div className="p-16 [border-top:var(--panel-head-border)]">
                <FilteredEmpty batches={batches} query={query} setQuery={setQuery} onClear={clear} />
              </div>
            ) : (
              <EmissionsOverviewTable rows={rows} query={query} facilityId={facilityId} onSort={toggleSort} />
            )}
          </>
        )}
      </div>

      <section aria-label={ACTIVITY_TITLE} className="flex flex-col gap-16">
        <button
          type="button"
          aria-expanded={activityOpen}
          aria-controls={ACTIVITY_REGION_ID}
          onClick={() => void setActivityOpen(activityOpen ? null : true)}
          className="inline-flex min-h-44 items-center gap-6 self-start body-small font-medium text-[var(--color-text-interaction-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        >
          {activityOpen ? (
            <CaretDownIcon size={16} weight="bold" aria-hidden />
          ) : (
            <CaretRightIcon size={16} weight="bold" aria-hidden />
          )}
          {ACTIVITY_TITLE}
        </button>
        {activityOpen && (
          <div id={ACTIVITY_REGION_ID}>
            <FacilityActivity facilityId={facilityId} caption={entriesEnabled ? ACTIVITY_CAPTION : undefined} />
          </div>
        )}
      </section>
    </div>
  );
}
