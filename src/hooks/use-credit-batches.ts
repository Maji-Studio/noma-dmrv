import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getCreditBatchesFn,
  getCreditBatchByIdFn,
  getCo2eStoredPreviewsFn,
  getCreditBatchProductionRunOptionsFn,
  createCreditBatchFn,
  updateCreditBatchFn,
  deleteCreditBatchFn,
} from "@/fn/credit-batches";
import type {
  CreditBatchFormData,
  UpdateCreditBatchData,
} from "@/schemas/credit-batches";
import type { CreditBatchCo2eStoredPreview } from "@/data-access/credit-batches";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { invalidateCertificationReadiness } from "./use-certification";
import { invalidateOnboardingProgress } from "./use-onboarding";

export { creditBatchKeys } from "./credit-batch-query-keys";

// Credit-batch data changes infrequently within a session; 30s keeps the UI
// fresh without re-fetching on every mount.
const CREDIT_BATCH_STALE_TIME_MS = 30_000;
const CREDIT_BATCH_PREVIEW_CHUNK_SIZE = 50;

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
    queryFn: async () => {
      if (!facilityId) return [];
      const result = await getCreditBatchesFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
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
    queryFn: async () => {
      const result = await getCreditBatchByIdFn(id);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!id,
    staleTime: CREDIT_BATCH_STALE_TIME_MS,
  });
}

export function useCreditBatchCo2eStoredPreviews(batchIds: string[]) {
  const sortedIds = [...batchIds].sort();
  const chunks = chunkIds(sortedIds, CREDIT_BATCH_PREVIEW_CHUNK_SIZE);
  const results = useQueries({
    queries: chunks.map((ids) => ({
      queryKey: creditBatchKeys.previews(ids),
      queryFn: async () => {
        const result = await getCo2eStoredPreviewsFn(ids);
        if (!result.success) throw new Error(result.error);
        return result.data;
      },
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
      const result = await getCreditBatchProductionRunOptionsFn({
        facilityId,
        startDate,
        endDate,
        includeCreditBatchId,
      });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
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
    mutationFn: (data: CreditBatchFormData) => createCreditBatchFn(data),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.productionRunOptionsPrefix(),
      });
      invalidateCertificationReadiness(queryClient);
      await invalidateOnboardingProgress(queryClient);
    },
  });
}

/**
 * Mutation hook for updating a credit batch
 */
export function useUpdateCreditBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateCreditBatchData) => updateCreditBatchFn(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.productionRunOptionsPrefix(),
      });
      invalidateCertificationReadiness(queryClient, {
        creditBatchPreviews: true,
      });
      if (result.success && result.data) {
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
    mutationFn: (creditBatchId: string) =>
      deleteCreditBatchFn({ creditBatchId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
      invalidateCertificationReadiness(queryClient);
    },
  });
}
