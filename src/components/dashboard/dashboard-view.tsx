/**
 * DashboardView — the Flow Hero dashboard, deliberately simple: the display
 * headline, the 4-stat KPI band, the isometric traceability hero (the single
 * "see the chain" surface with its Overview / Flow / Needs-attention views),
 * and a supporting row below — the open-items list, the recent-activity feed,
 * and the certification summary. All facility-scoped via the sidebar selector
 * like every other page.
 */
"use client";

import { useState } from "react";
import { WarningOctagonIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import type { DashboardRange } from "@/data-access/dashboard-overview";
import { HeroKpiBand } from "./hero-kpi-band";
import { FlowHero } from "./flow-hero";
import { AttentionList } from "./attention-list";
import { ActivityFeed } from "./activity-feed";
import { CertificationBlock } from "./certification-block";
import { RangeToggle } from "./range-toggle";

const DEFAULT_RANGE: DashboardRange = "month";

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
          {/* Blank/whitespace-only names (legacy/manual data — the schema now
              trims on every write) fall back to the always-present code so the
              title never renders empty (#378). */}
          <h1 className="title-heading-1 truncate">
            {facilityId
              ? selectedFacility
                ? selectedFacility.name?.trim() || selectedFacility.code
                : "Facility"
              : "Operations"}
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
          <HeroKpiBand kpis={data?.kpis} isLoading={isLoading} />

          <FlowHero
            stations={data?.stations}
            massFlow={data?.massFlow}
            runningRuns={data?.runningRuns ?? 0}
            isLoading={isLoading}
            facilityId={facilityId}
          />

          {/* Supporting row — only with data; an empty "all clear" list during
              loading would read as a (false) signal. */}
          {data && (
            <div className="grid grid-cols-1 gap-24 lg:grid-cols-2 xl:grid-cols-3">
              <AttentionList attention={data.attention} />
              <ActivityFeed activity={data.activity} />
              <CertificationBlock
                certification={data.certification}
                facilityId={facilityId}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
