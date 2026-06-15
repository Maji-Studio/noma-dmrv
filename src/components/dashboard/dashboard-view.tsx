/**
 * DashboardView — the facility operations dashboard. An operational header
 * (facility name + live "updated" stamp, no marketing hero) over two halves:
 * the measurement half (the 5-KPI strip, feedstock mix, custody-flow ribbon)
 * and the action half restored from the operator dashboard (record checks,
 * the live "Now" signal, the MRV pipeline funnel, evidence health). All
 * facility-scoped via the sidebar selector like every other page.
 */
"use client";

import { useState } from "react";
import { Buildings, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import type { DashboardRange } from "@/data-access/dashboard-overview";
import { DashboardKpis } from "./dashboard-kpis";
import { AttentionQueue } from "./attention-queue";
import { NowPanel } from "./now-panel";
import { ProgressPipeline } from "./progress-pipeline";
import { FeedstockMix } from "./feedstock-mix";
import { EvidenceHealth } from "./evidence-health";
import { MapPreview } from "./map-preview";
import { RangeToggle } from "./range-toggle";

const DEFAULT_RANGE: DashboardRange = "30d";

function formatUpdated(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function DashboardView() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const [range, setRange] = useState<DashboardRange>(DEFAULT_RANGE);
  const { data, isLoading, error } = useDashboardOverview(facilityId, range);

  return (
    <div className="container-max page-shell">
      <header className="flex flex-wrap items-end justify-between gap-24">
        <div className="flex min-w-0 flex-col gap-8">
          <p className="label-micro text-[var(--color-text-tertiary)]">
            Dashboard
          </p>
          <h1 className="title-heading-1 truncate">
            {facilityId ? (selectedFacility?.name ?? "Facility") : "Operations"}
          </h1>
          <p className="body-medium text-[var(--color-text-secondary)]">
            {facilityId
              ? data
                ? `Live operations · updated ${formatUpdated(data.generatedAt)}`
                : "Live operations across this facility"
              : "Select a facility to monitor its carbon removal."}
          </p>
        </div>
        {facilityId && <RangeToggle value={range} onChange={setRange} />}
      </header>

      {!facilityId ? (
        <EmptyState
          icon={<Buildings size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to monitor its carbon removal."
        />
      ) : error ? (
        <EmptyState
          padding="md"
          icon={<WarningOctagon size={40} />}
          title="Couldn't load the dashboard"
          description={error.message}
        />
      ) : (
        <>
          <DashboardKpis kpis={data?.kpis} isLoading={isLoading} />

          {/* Panels only mount with data — an empty "all clear" queue during
              loading would read as a (false) signal. */}
          {data && (
            <>
              <div className="grid grid-cols-1 gap-24 xl:grid-cols-[1.4fr_1fr]">
                <AttentionQueue items={data.attention} />
                <NowPanel items={data.now} />
              </div>

              <ProgressPipeline stages={data.progress} />

              <div className="grid grid-cols-1 gap-24 xl:grid-cols-2">
                <FeedstockMix slices={data.feedstockMix} />
                <EvidenceHealth rows={data.evidence} facilityId={facilityId} />
              </div>

              <MapPreview points={data.mapPoints} />
            </>
          )}
        </>
      )}
    </div>
  );
}
