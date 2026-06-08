import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCreditBatchesFn,
  getCreditBatchByIdFn,
  getCo2eStoredPreviewsFn,
  getCreditBatchApplicationOptionsFn,
  createCreditBatchFn,
  updateCreditBatchFn,
  deleteCreditBatchFn,
} from "@/fn/credit-batches";
import type {
  CreditBatchFormData,
  UpdateCreditBatchData,
} from "@/schemas/credit-batches";

// Credit-batch data changes infrequently within a session; 30s keeps the UI
// fresh without re-fetching on every mount.
const CREDIT_BATCH_STALE_TIME_MS = 30_000;

/**
 * Query key factory for credit batches
 */
export const creditBatchKeys = {
  all: ["creditBatches"] as const,
  lists: () => [...creditBatchKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...creditBatchKeys.lists(), filters] as const,
  details: () => [...creditBatchKeys.all, "detail"] as const,
  detail: (id: string) => [...creditBatchKeys.details(), id] as const,
  previews: (ids: string[]) => [...creditBatchKeys.all, "previews", ids] as const,
  applicationOptions: (facilityId?: string) =>
    [...creditBatchKeys.all, "applicationOptions", facilityId] as const,
};

/**
 * Query hook for fetching all credit batches
 */
export function useCreditBatches() {
  return useQuery({
    queryKey: creditBatchKeys.lists(),
    queryFn: async () => {
      const result = await getCreditBatchesFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
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

  return useQuery({
    queryKey: creditBatchKeys.previews(sortedIds),
    queryFn: async () => {
      const result = await getCo2eStoredPreviewsFn(sortedIds);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: sortedIds.length > 0,
    staleTime: CREDIT_BATCH_STALE_TIME_MS,
  });
}

export function useCreditBatchApplicationOptions(facilityId?: string) {
  return useQuery({
    queryKey: creditBatchKeys.applicationOptions(facilityId),
    queryFn: async () => {
      if (!facilityId) return [];
      const result = await getCreditBatchApplicationOptionsFn(facilityId);
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
 * Mutation hook for creating a credit batch
 */
export function useCreateCreditBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreditBatchFormData) => createCreditBatchFn(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: creditBatchKeys.lists() });
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
    },
  });
}
