import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getCreditBatchActivityRead, getCreditBatchActivitySummaryRead } from "@/lib/read-api/client";
import { unwrap } from "./types";
import { activityKeys } from "./activity-query-keys";

export { activityKeys } from "./activity-query-keys";
export function useCreditBatchActivity(creditBatchId: string, options: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: activityKeys.creditBatch(creditBatchId, options.limit),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => unwrap(await getCreditBatchActivityRead({ creditBatchId, cursor: pageParam, limit: options.limit }, { signal })),
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
