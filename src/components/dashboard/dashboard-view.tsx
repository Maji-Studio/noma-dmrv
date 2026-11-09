/**
 * DashboardView — the dashboard page: the title with its credit batch filter,
 * then the body (KPI band, stage band, To do, Bins, Recent activity). All
 * facility-scoped via the sidebar selector like every other page; the setup
 * guide takes over the body for a facility that is not set up yet.
 */
"use client";

import { useState } from "react";
import { SelectFacilityEmptyState } from "@/components/navigation";
import {
  SetupGuide,
  SetupGuideSkeleton,
  SetupInProgressState,
  SetupStrip,
  useSetupGuide,
} from "@/components/onboarding";
import { SetupCreateSheet } from "@/components/onboarding/setup-create-sheet";
import { RegistryConnectionDialog } from "@/components/certification/registry-connection-dialog";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { DashboardBody } from "./dashboard-body";
import { BatchFilter } from "./scope";
import { updatedLabel } from "./updated-label";
import { Skeleton } from "@/components/ui/loading-skeleton";

/** The "Updated 16:16" line's box while the overview loads (body-small). */
const UPDATED_LINE_HEIGHT = 20;
const UPDATED_LINE_WIDTH = 96;

export function DashboardView() {
  const { activeOrganizationId, facilityId, selectedFacility } = useFacilityContext();
  const { timeZone } = useFacilityClock(facilityId);
  const [setupSurface, setSetupSurface] = useState<"facility" | "reactor" | "registry" | null>(null);
  const { data, isLoading, error, refetch } = useDashboardOverview(facilityId, "all");

  // First-run onboarding decides whether the setup surfaces take over the body
  // (a fresh facility would render meaningless zeros), recede to a strip, or
  // stay out of the way once setup is complete.
  const onboarding = useSetupGuide(facilityId, activeOrganizationId);
  const setupActions = {
    facilityId,
    onOpenFacility: () => setSetupSurface("facility"),
    onOpenReactor: () => setSetupSurface("reactor"),
    onOpenRegistry: () => setSetupSurface("registry"),
  };
  const isTakeover =
    onboarding.mode === "takeover-guide" ||
    onboarding.mode === "takeover-member";

  return (
    <div className="container-max page-shell">
      <header className="flex flex-wrap items-start justify-between gap-24">
        <div className="flex min-w-0 flex-col gap-6">
          <h1 className="title-heading-2">Dashboard</h1>
          {facilityId && !data && isLoading ? (
            // Holds the "Updated 16:16" line's place, so the header does not shift.
            <Skeleton height={UPDATED_LINE_HEIGHT} width={UPDATED_LINE_WIDTH} />
          ) : (
            <p className="body-small text-[var(--color-text-secondary)]">
              {data
                ? updatedLabel(data.generatedAt, timeZone)
                : facilityId
                  ? null
                  : "Select a facility to monitor its carbon removal."}
            </p>
          )}
        </div>
        {facilityId && !isTakeover && <BatchFilter facilityId={facilityId} />}
      </header>

      {onboarding.mode === "loading" ? (
        <SetupGuideSkeleton />
      ) : isTakeover ? (
        onboarding.mode === "takeover-member" ? (
          <SetupInProgressState />
        ) : (
          <SetupGuide
            progress={onboarding.progress}
            actions={setupActions}
            onCollapse={() => onboarding.setCollapsed(true)}
          />
        )
      ) : (
        <>
          {onboarding.mode === "strip" && (
            <SetupStrip
              progress={onboarding.progress}
              actions={setupActions}
              onExpand={() => onboarding.setCollapsed(false)}
            />
          )}
          {!facilityId ? (
            <SelectFacilityEmptyState description="Choose a facility from the sidebar to monitor its carbon removal." />
          ) : (
            <DashboardBody
              data={data}
              isLoading={isLoading}
              error={error}
              onRetry={() => void refetch()}
              facilityId={facilityId}
              timeZone={timeZone}
              status={onboarding.status}
            />
          )}
        </>
      )}

      {(setupSurface === "facility" || setupSurface === "reactor") && (
        <SetupCreateSheet key={setupSurface} entity={setupSurface} onClose={() => setSetupSurface(null)} />
      )}
      {setupSurface === "registry" && facilityId && (
        <RegistryConnectionDialog
          key={facilityId}
          facilityId={facilityId}
          facilityLabel={selectedFacility?.code}
          canManage={onboarding.status?.canManage ?? false}
          onClose={() => setSetupSurface(null)}
        />
      )}
    </div>
  );
}
