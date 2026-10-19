import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getCreditBatchActivityRead, getCreditBatchActivitySummaryRead } from "@/lib/read-api/client";
import { unwrap } from "./types";
import { activityKeys } from "./activity-query-keys";
import type { ActivityFilters } from "@/lib/activity-filters";

export { activityKeys } from "./activity-query-keys";
export function useCreditBatchActivity(creditBatchId: string, options: { limit?: number; filters?: ActivityFilters } = {}) {
  const { action, entityType } = options.filters ?? {};
  return useInfiniteQuery({
    queryKey: activityKeys.creditBatch(creditBatchId, options.limit, { action, entityType }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => unwrap(await getCreditBatchActivityRead({
      creditBatchId, cursor: pageParam, limit: options.limit, ...(action ? { action } : {}), ...(entityType ? { entityType } : {}),
    }, { signal })),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: !!creditBatchId,
    staleTime: 0,
  });
}

export function useCreditBatchActivitySummary(creditBatchId: string) {
  return useQuery({
    queryKey: activityKeys.creditBatchSummary(creditBatchId),
    queryFn: async ({ signal }) => unwrap(await getCreditBatchActivitySummaryRead({ creditBatchId }, { signal })),
    enabled: !!creditBatchId,
    staleTime: 0,
  });
}
