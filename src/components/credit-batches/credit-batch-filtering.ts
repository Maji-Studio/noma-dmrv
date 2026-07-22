import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { BatchHealthState } from "@/lib/certification/batch-health";
import type { CreditBatchReadinessFilter } from "./credit-batch-filters";

export interface CreditBatchFilterValues {
  startDate: string;
  endDate: string;
  feedstockTypeIds: string[];
  readiness: CreditBatchReadinessFilter;
}

export function readinessErrorBlocksList(
  readiness: CreditBatchReadinessFilter,
  error: Error | null,
): boolean {
  return readiness !== "all" && error !== null;
}

/**
 * Applies the list's operator filters. Date bounds use production-window
 * overlap, so a batch remains visible whenever any part of its period falls
 * inside the selected range.
 */
export function filterCreditBatches(
  batches: CreditBatchWithRelations[],
  healthStates: Record<string, BatchHealthState | undefined>,
  filters: CreditBatchFilterValues,
): CreditBatchWithRelations[] {
  const selectedFeedstocks = new Set(filters.feedstockTypeIds);

  return batches.filter((batch) => {
    const overlapsDateRange =
      (!filters.startDate || batch.endDate >= filters.startDate) &&
      (!filters.endDate || batch.startDate <= filters.endDate);
    const matchesFeedstock =
      selectedFeedstocks.size === 0 ||
      selectedFeedstocks.has(batch.feedstockTypeId);
    const healthState = healthStates[batch.id];
    const matchesReadiness =
      filters.readiness === "all" ||
      (filters.readiness === "ready" && healthState === "ready") ||
      (filters.readiness === "needs_attention" && healthState === "incomplete");

    return overlapsDateRange && matchesFeedstock && matchesReadiness;
  });
}
