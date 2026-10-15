export const activityKeys = {
  all: ["activity"] as const,
  creditBatchSummary: (creditBatchId: string) => [...activityKeys.all, "credit-batch-summary", creditBatchId] as const,
  creditBatch: (creditBatchId: string, limit?: number) => [...activityKeys.all, "credit-batch", creditBatchId, { limit }] as const,
};
