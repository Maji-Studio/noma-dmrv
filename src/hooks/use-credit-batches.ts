import { getCreditBatchPageModelFn } from "@/fn/credit-batch-page-model";
import type { ActionResult } from "@/types/actions";
import type { DeleteCreditBatchData } from "@/schemas/credit-batches";
import { StaleVersionError, throwActionError } from "@/lib/stale-version";
import { patchArrayListCachesByPrefixWithSavedRow } from "./list-cache-utils";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getCreditBatchByIdFn,
  getCo2eStoredPreviewsFn,
  getCreditBatchProductionRunOptionsFn,
  createCreditBatchFn,
  updateCreditBatchFn,
  deleteCreditBatchFn,
} from "@/fn/credit-batches";
import { loadCreditBatchTimelineFactsFn } from "@/fn/credit-batch-timeline-facts";
import { getCreditBatchesRead } from "@/lib/read-api/client";
import type {
  CreditBatchFormData,
  UpdateCreditBatchData,
} from "@/schemas/credit-batches";
import type { CreditBatchTimelineFacts } from "@/data-access/credit-batch-timeline-facts";
import type { CreditBatchCo2eStoredPreview } from "@/data-access/credit-batches";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { invalidateCertificationReadiness } from "./use-certification";
import { invalidateOnboardingProgress } from "./use-onboarding";
import { unwrap } from "@/hooks/types";

export { creditBatchKeys } from "./credit-batch-query-keys";

// Credit-batch data changes infrequently within a session; 30s keeps the UI
// fresh without re-fetching on every mount.
const CREDIT_BATCH_STALE_TIME_MS = 30_000;
const CREDIT_BATCH_PREVIEW_CHUNK_SIZE = 50;
/** Matches the server's per-request cap for timeline facts. */
const CREDIT_BATCH_TIMELINE_CHUNK_SIZE = 200;

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

/**
 * Query hook for fetching a facility's credit batches. Facility-scoped: the
 * facilityId is part of the query key so switching facilities refetches rather
 * than serving another facility's batches from cache.
 */
export function useCreditBatches(facilityId?: string) {
  return useQuery({
    queryKey: creditBatchKeys.list({ facilityId }),
    queryFn: async ({ signal }) => {
      if (!facilityId) return [];
      return unwrap(await getCreditBatchesRead(facilityId, { signal }));
    },
    enabled: !!facilityId,
    staleTime: CREDIT_BATCH_STALE_TIME_MS,
  });
}

/**
 * Query hook for fetching a single credit batch
 */
export function useCreditBatch(id: string) {
  return useQuery({
    queryKey: creditBatchKeys.detail(id),
    queryFn: async () => unwrap(await getCreditBatchByIdFn(id)),
    enabled: !!id,
    staleTime: CREDIT_BATCH_STALE_TIME_MS,
  });
}

/** Produced, applied and Removal facts for the timeline's hover cards, one request per facility. */
export function useCreditBatchTimelineFacts(facilityId: string | undefined, batchIds: string[]) {
  const sortedIds = [...batchIds].sort();
  const results = useQueries({
    queries: chunkIds(sortedIds, CREDIT_BATCH_TIMELINE_CHUNK_SIZE).map((ids) => ({
      queryKey: creditBatchKeys.timelineFacts(facilityId ?? "", ids),
      queryFn: async () => unwrap(await loadCreditBatchTimelineFactsFn(facilityId ?? "", ids)),
      enabled: !!facilityId,
      staleTime: CREDIT_BATCH_STALE_TIME_MS,
    })),
  });
  return {
    data: results.reduce<Record<string, CreditBatchTimelineFacts>>(
      (facts, result) => Object.assign(facts, result.data ?? {}),
      {},
    ),
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    error: results.find((result) => result.error)?.error ?? null,
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}

export function useCreditBatchCo2eStoredPreviews(batchIds: string[]) {
  const sortedIds = [...batchIds].sort();
  const chunks = chunkIds(sortedIds, CREDIT_BATCH_PREVIEW_CHUNK_SIZE);
  const results = useQueries({
    queries: chunks.map((ids) => ({
      queryKey: creditBatchKeys.previews(ids),
      queryFn: async () => unwrap(await getCo2eStoredPreviewsFn(ids)),
      staleTime: CREDIT_BATCH_STALE_TIME_MS,
    })),
  });

  const resolved = resolveCreditBatchCo2ePreviews(results);

  return {
    ...resolved,
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}

export function resolveCreditBatchCo2ePreviews(
  results: ReadonlyArray<{
    data?: Record<string, CreditBatchCo2eStoredPreview>;
    error: Error | null;
  }>,
) {
  const error = results.find((result) => result.error)?.error ?? null;
  return {
    data: error
      ? undefined
      : results.reduce<Record<string, CreditBatchCo2eStoredPreview>>(
          (previews, result) => Object.assign(previews, result.data ?? {}),
          {},
        ),
    error,
  };
}

export function useCreditBatchProductionRunOptions(params: {
  facilityId?: string;
  startDate?: string;
  endDate?: string;
  includeCreditBatchId?: string;
}) {
  const { facilityId, startDate, endDate, includeCreditBatchId } = params;
  return useQuery({
    queryKey: creditBatchKeys.productionRunOptions(
      facilityId,
      startDate,
      endDate,
      includeCreditBatchId,
    ),
    queryFn: async () => {
      if (!facilityId || !startDate || !endDate) return [];
      return unwrap(
        await getCreditBatchProductionRunOptionsFn({
          facilityId,
          startDate,
          endDate,
          includeCreditBatchId,
        }),
      );
    },
    enabled: !!facilityId && !!startDate && !!endDate,
    staleTime: CREDIT_BATCH_STALE_TIME_MS,
  });
}

/**
 * Mutation hook for creating a credit batch
 */
export function useCreateCreditBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    // The batch and the warning are two facts about one committed write: the
    // batch is saved either way, and `warning` says its accounting roll-up did
    // not load with it (issue #769).
    mutationFn: async (data: CreditBatchFormData) => {
      const result = await createCreditBatchFn(data);
      if (!result.success) throw new Error(result.error);
      return { creditBatch: result.data, warning: result.warning };
    },
    onSuccess: ({ creditBatch }) => {
      // The created row is not an authoritative detail: when its post-commit
      // roll-up did not load, its applied tonnage and application slices are
      // unknown, and seeding it would serve those unknowns for the whole
      // staleTime window. Refetch the detail instead (issue #769).
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.detail(creditBatch.id),
      });
      const listRefresh = queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.productionRunOptionsPrefix(),
      });
      invalidateCertificationReadiness(queryClient);
      invalidateOnboardingProgress(queryClient, creditBatch.facilityId);
      // The create sheet closes after this resolves; its own list must show the row.
      return listRefresh;
    },
  });
}

/**
 * Mutation hook for updating a credit batch
 */
export function useUpdateCreditBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateCreditBatchData): Promise<Awaited<ReturnType<typeof updateCreditBatchFn>>> => {
      const result = await updateCreditBatchFn(data);
      if (!result.success) throwActionError(result);
      return result;
    },
    onSuccess: (result) => {
      if (result.success) patchArrayListCachesByPrefixWithSavedRow(queryClient, creditBatchKeys.lists(), result.data);
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.productionRunOptionsPrefix(),
      });
      invalidateCertificationReadiness(queryClient, {
        creditBatchPreviews: true,
      });
      if (result.success && result.data) {
        queryClient.setQueryData(creditBatchKeys.detail(result.data.id), (old: object | undefined) => old ? { ...old, ...result.data } : old);
        queryClient.invalidateQueries({
          queryKey: creditBatchKeys.detail(result.data.id),
        });
      }
    },
  });
}

/**
 * Mutation hook for deleting a credit batch
 */
export function useDeleteCreditBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: DeleteCreditBatchData): Promise<ActionResult<void>> => {
      const result = await deleteCreditBatchFn(data);
      if (!result.success) throwActionError(result);
      return result;
    },
    onError: (error, variables) => {
      if (error instanceof StaleVersionError) {
        queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
        queryClient.invalidateQueries({ queryKey: creditBatchKeys.detail(variables.creditBatchId) });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
      invalidateCertificationReadiness(queryClient);
    },
  });
}

export function useCreditBatchPageModel(creditBatchId: string) {
  return useQuery({
    queryKey: creditBatchKeys.pageModel(creditBatchId),
    queryFn: async () => unwrap(await getCreditBatchPageModelFn(creditBatchId)),
    enabled: !!creditBatchId,
    staleTime: CREDIT_BATCH_STALE_TIME_MS,
  });
}
