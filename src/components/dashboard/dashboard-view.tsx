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
import {
  OnboardingWizard,
  SetupGuide,
  SetupInProgressState,
  SetupStrip,
  useOnboardingGate,
} from "@/components/onboarding";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import type { DashboardRange } from "@/data-access/dashboard-overview";
import { formatDateTime } from "@/lib/format-utils";
import { HeroKpiBand } from "./hero-kpi-band";
import { FlowHero } from "./flow-hero";
import { AttentionList } from "./attention-list";
import { ActivityFeed } from "./activity-feed";
import { CertificationBlock } from "./certification-block";
import { RangeToggle } from "./range-toggle";

const DEFAULT_RANGE: DashboardRange = "month";

export function DashboardView() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const [range, setRange] = useState<DashboardRange>(DEFAULT_RANGE);
  const { data, isLoading, error } = useDashboardOverview(facilityId, range);

  // First-run onboarding decides whether the setup surfaces take over the body
  // (a fresh facility would render meaningless zeros), recede to a strip, or
  // stay out of the way once setup is complete. The wizard is always mounted —
  // the dashboard is the post-login landing.
  const onboarding = useOnboardingGate(facilityId);
  const isTakeover =
    onboarding.mode === "takeover-guide" ||
    onboarding.mode === "takeover-member";

  return (
    <div className="container-max page-shell">
      <header className="flex flex-wrap items-end justify-between gap-24">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Facility rides in the eyebrow (per the hero design) so long names
              never truncate the display title. Blank/whitespace-only names
              (legacy/manual data — the schema now trims on every write) fall
              back to the always-present code (#378). */}
          <p className="label-micro truncate text-[var(--color-text-tertiary)]">
            {facilityId
              ? selectedFacility
                ? selectedFacility.name?.trim() || selectedFacility.code
                : "Facility"
              : "Operations"}
          </p>
          <h1 className="title-heading-2">Dashboard</h1>
          <p className="body-small text-[var(--color-text-secondary)]">
            {facilityId
              ? data
                ? `Live operations · updated ${formatDateTime(data.generatedAt)}`
                : "Live operations across this facility"
              : "Select a facility to monitor its carbon removal."}
          </p>
        </div>
        {facilityId && !isTakeover && (
          <RangeToggle value={range} onChange={setRange} />
        )}
      </header>

      {isTakeover ? (
        onboarding.mode === "takeover-member" ? (
          <SetupInProgressState />
        ) : (
          <SetupGuide
            progress={onboarding.progress}
            onStartFacility={onboarding.wizard.open}
            onCollapse={() => onboarding.setCollapsed(true)}
          />
        )
      ) : (
        <>
          {onboarding.mode === "strip" && (
            <SetupStrip
              progress={onboarding.progress}
              onExpand={() => onboarding.setCollapsed(false)}
            />
          )}
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
            <DashboardBody
              data={data}
              isLoading={isLoading}
              facilityId={facilityId}
            />
          )}
        </>
      )}

      <OnboardingWizard wizard={onboarding.wizard} status={onboarding.status} />
    </div>
  );
}

function DashboardBody({
  data,
  isLoading,
  facilityId,
}: {
  data: ReturnType<typeof useDashboardOverview>["data"];
  isLoading: boolean;
  facilityId: string;
}) {
  return (
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
          <AttentionList
            attention={data.attention}
            structuralGaps={data.structuralGaps}
            total={data.attentionTotal}
            flagsTotal={data.attentionFlagsTotal}
          />
          <ActivityFeed activity={data.activity} />
          <CertificationBlock
            certification={data.certification}
            facilityId={facilityId}
          />
        </div>
      )}
    </>
  );
}
