import type { DashboardRange } from "@/data-access/dashboard-overview";

export const dashboardOverviewKeys = {
  all: ["dashboard-overview"] as const,
  overview: (facilityId: string | null, range: DashboardRange) =>
    [...dashboardOverviewKeys.all, facilityId, range] as const,
  batchScope: (facilityId: string | null, creditBatchId: string | null) =>
    [...dashboardOverviewKeys.all, "batch-scope", facilityId, creditBatchId] as const,
};
