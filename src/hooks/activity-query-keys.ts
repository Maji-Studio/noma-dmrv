import type { ActivityFilters } from "@/lib/activity-filters";

export const activityKeys = {
  all: ["activity"] as const,
  creditBatchSummary: (creditBatchId: string) => [...activityKeys.all, "credit-batch-summary", creditBatchId] as const,
  creditBatch: (creditBatchId: string, limit?: number, filters: ActivityFilters = {}) =>
    [...activityKeys.all, "credit-batch", creditBatchId, { limit, action: filters.action, entityType: filters.entityType }] as const,
};
