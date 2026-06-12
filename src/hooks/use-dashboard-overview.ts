import { useQuery } from "@tanstack/react-query";
import {
  loadDashboardOverview,
  type DashboardOverviewInput,
} from "@/fn/dashboard-overview";

const DASHBOARD_STALE_MS = 30_000;
const DASHBOARD_REFETCH_MS = 5 * 60_000;

export const dashboardOverviewKeys = {
  all: ["dashboard-overview"] as const,
  overview: (input?: DashboardOverviewInput) =>
    [
      ...dashboardOverviewKeys.all,
      input?.facilityId ?? "all",
      input?.periodDays ?? 30,
    ] as const,
};

export function useDashboardOverview(input?: DashboardOverviewInput) {
  return useQuery({
    queryKey: dashboardOverviewKeys.overview(input),
    queryFn: async () => {
      const result = await loadDashboardOverview(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: DASHBOARD_STALE_MS,
    refetchInterval: DASHBOARD_REFETCH_MS,
  });
}
