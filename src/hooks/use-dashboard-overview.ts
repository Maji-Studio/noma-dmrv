"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getDashboardOverviewRead } from "@/lib/read-api/client";
import type { DashboardRange } from "@/data-access/dashboard-overview";
import { unwrap } from "./types";
import { dashboardOverviewKeys } from "./dashboard-overview-query-keys";

export { dashboardOverviewKeys };

// Dashboard aggregates are "current data" — 30s keeps the strip fresh without
// refetching on every mount (project React Query convention).
const DASHBOARD_OVERVIEW_STALE_TIME_MS = 30_000;

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
    queryFn: async ({ signal }) => {
      if (!facilityId) throw new Error("No facility selected");
      return unwrap(await getDashboardOverviewRead({ facilityId, range }, { signal }));
    },
    enabled: !!facilityId,
    staleTime: DASHBOARD_OVERVIEW_STALE_TIME_MS,
    // Range/facility switches keep the previous panels in place instead of
    // unmounting the page back to skeletons.
    placeholderData: keepPreviousData,
  });
}
