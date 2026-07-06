/**
 * DashboardView — the facility operations dashboard, consolidated into four
 * top-to-bottom altitudes: the 5-KPI strip (the numbers), the Action center
 * (the single "what needs me" surface — record flags, evidence gaps, and the
 * live signal merged), the Traceability hero (the custody flow over an
 * interactive directional map), and a supporting strip (the MRV pipeline
 * funnel and the feedstock breakdown). All facility-scoped via the sidebar
 * selector like every other page.
 */
"use client";

import { useState } from "react";
import { WarningOctagonIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import type { DashboardRange } from "@/data-access/dashboard-overview";
import { DashboardKpis } from "./dashboard-kpis";
import { ActionCenter } from "./action-center";
import { ProgressPipeline } from "./progress-pipeline";
import { FeedstockMix } from "./feedstock-mix";
import { TraceabilitySection } from "./traceability-section";
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
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to monitor its carbon removal." />
      ) : error ? (
        <EmptyState
          padding="md"
          icon={<WarningOctagonIcon size={40} />}
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
              <ActionCenter
                attention={data.attention}
                evidence={data.evidence}
                now={data.now}
                facilityId={facilityId}
              />

              <TraceabilitySection
                flow={data.flow}
                points={data.mapPoints}
                edges={data.mapEdges}
                facilityId={facilityId}
              />

              <ProgressPipeline stages={data.progress} />

              <FeedstockMix slices={data.feedstockMix} />
            </>
          )}
        </>
      )}
    </div>
  );
}
