/**
 * DashboardView — the facility monitoring dashboard (visual design plan,
 * Phase 5; target: the `01-dash` inspiration mock). Breadcrumb-style mono
 * eyebrow + display headline, period toggle, the 5-KPI strip with sparklines
 * and delta badges, the record-checks queue, the feedstock mix, and the
 * facility-wide custody-flow ribbon. Facility-scoped via the sidebar
 * selector like every other page.
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
import { FeedstockMix } from "./feedstock-mix";
import { CustodyFlowRibbon } from "./custody-flow-ribbon";
import { RangeToggle } from "./range-toggle";

const DEFAULT_RANGE: DashboardRange = "30d";

export function DashboardView() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const [range, setRange] = useState<DashboardRange>(DEFAULT_RANGE);
  const { data, isLoading, error } = useDashboardOverview(facilityId, range);

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex flex-wrap items-end justify-between gap-24">
        <div className="flex min-w-0 flex-col gap-8">
          <p className="title-chapter-title text-[var(--color-text-tertiary)]">
            Noma · Biochar carbon removal
            {selectedFacility ? ` · ${selectedFacility.name}` : ""}
          </p>
          <h1 className="title-heading-1 max-w-[16ch]">
            Carbon removal,{" "}
            <span className="title-heading-1-thin">traced end to end.</span>
          </h1>
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
              <div className="grid grid-cols-1 gap-24 xl:grid-cols-[1.6fr_1fr]">
                <AttentionQueue items={data.attention} />
                <FeedstockMix slices={data.feedstockMix} />
              </div>
              <CustodyFlowRibbon flow={data.flow} facilityId={facilityId} />
            </>
          )}
        </>
      )}
    </div>
  );
}
