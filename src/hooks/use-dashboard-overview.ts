"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getDashboardOverviewFn } from "@/fn/dashboard-overview";
import type { DashboardRange } from "@/data-access/dashboard-overview";

// Dashboard aggregates are "current data" — 30s keeps the strip fresh without
// refetching on every mount (project React Query convention).
const DASHBOARD_OVERVIEW_STALE_TIME_MS = 30_000;

export const dashboardOverviewKeys = {
  all: ["dashboard-overview"] as const,
  overview: (facilityId: string | null, range: DashboardRange) =>
    [...dashboardOverviewKeys.all, facilityId, range] as const,
};

/**
 * Facility dashboard overview (KPI band, traceability stations, mass flow,
 * attention queue, activity, certification). Disabled until a facility is
 * selected.
 */
export function useDashboardOverview(
  facilityId: string | null,
  range: DashboardRange,
) {
  return useQuery({
    queryKey: dashboardOverviewKeys.overview(facilityId, range),
    queryFn: async () => {
      if (!facilityId) throw new Error("No facility selected");
      const result = await getDashboardOverviewFn({ facilityId, range });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!facilityId,
    staleTime: DASHBOARD_OVERVIEW_STALE_TIME_MS,
    // Range/facility switches keep the previous panels in place instead of
    // unmounting the page back to skeletons.
    placeholderData: keepPreviousData,
  });
}
