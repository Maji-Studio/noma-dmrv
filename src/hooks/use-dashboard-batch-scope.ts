"use client";

import { useQuery } from "@tanstack/react-query";
import { getDashboardBatchScopeFn } from "@/fn/dashboard-batch-scope";
import { unwrap } from "./types";
import { dashboardOverviewKeys } from "./use-dashboard-overview";

const DASHBOARD_BATCH_SCOPE_STALE_TIME_MS = 30_000;

export function useDashboardBatchScope(
  facilityId: string | null,
  creditBatchId: string | null,
) {
  return useQuery({
    queryKey: dashboardOverviewKeys.batchScope(facilityId, creditBatchId),
    queryFn: async () => {
      if (!facilityId) throw new Error("No facility selected");
      return unwrap(await getDashboardBatchScopeFn({ facilityId, creditBatchId }));
    },
    enabled: !!facilityId,
    staleTime: DASHBOARD_BATCH_SCOPE_STALE_TIME_MS,
  });
}
