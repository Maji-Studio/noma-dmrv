/**
 * Feedstock React Query Hooks
 * Client-side state management for the unified delivery + bin allocation workflow.
 */

import { RECORD_LOCK_TOUCHES, recordLockMeta } from "./record-lock-query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FeedstockFilterData,
  FeedstockStatsFilterData,
  CreateFeedstockData,
  UpdateFeedstockData,
  DeleteFeedstockData,
} from "@/schemas/feedstocks";
import type {
  FeedstockWithRelations,
  CreateFeedstockResult,
} from "@/data-access/feedstocks";
import {
  getFeedstocksFn,
  getFeedstockByIdFn,
  getFeedstockStatsFn,
  createFeedstockFn,
  updateFeedstockFn,
  deleteFeedstockFn,
} from "@/fn/feedstocks";
import { StaleVersionError, throwActionError } from "@/lib/stale-version";
import { storageLocationKeys } from "./use-storage-locations";
import { unwrap, type MutationCallbacks } from "./types";
import { dashboardOverviewKeys } from "./use-dashboard-overview";
import { invalidateCertificationReadiness } from "./use-certification";
import { invalidateOnboardingProgress } from "./use-onboarding";
import { invalidateStockEntityQueries } from "./entity-query-keys";

// ============================================
// Query Keys
// ============================================

export const feedstockKeys = {
  all: ["feedstocks"] as const,
  lists: () => [...feedstockKeys.all, "list"] as const,
  list: (filters?: Partial<FeedstockFilterData>) =>
    [...feedstockKeys.lists(), filters] as const,
  details: () => [...feedstockKeys.all, "detail"] as const,
  detail: (id: string) => [...feedstockKeys.details(), id] as const,
  stats: (scope?: Partial<FeedstockStatsFilterData>) =>
    [...feedstockKeys.all, "stats", scope] as const,
  options: () => [...feedstockKeys.all, "options"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...feedstockKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Query Hooks
// ============================================

export function useFeedstocks(
  filters?: Partial<FeedstockFilterData>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: feedstockKeys.list(filters),
    queryFn: async () => unwrap(await getFeedstocksFn(filters)),
    staleTime: 30000,
    enabled: options?.enabled,
  });
}

export function useFeedstock(feedstockId: string, enabled = true) {
  return useQuery({
    queryKey: feedstockKeys.detail(feedstockId),
    queryFn: async () => unwrap(await getFeedstockByIdFn(feedstockId)),
    enabled: enabled && !!feedstockId,
    staleTime: 30000,
  });
}

export function useFeedstockStats(
  scope?: Partial<FeedstockStatsFilterData>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: feedstockKeys.stats(scope),
    queryFn: async () => unwrap(await getFeedstockStatsFn(scope)),
    staleTime: 30000,
    enabled: options?.enabled,
  });
}

// ============================================
// Mutation Hooks
// ============================================

export function useCreateFeedstock(callbacks?: MutationCallbacks<CreateFeedstockResult, CreateFeedstockData>) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: recordLockMeta(RECORD_LOCK_TOUCHES.feedstock),
    mutationFn: async (data: CreateFeedstockData) => unwrap(await createFeedstockFn(data)),
    onSuccess: async (data, variables) => {
      for (const feedstock of data.feedstocks) {
        queryClient.setQueryData(feedstockKeys.detail(feedstock.id), feedstock);
      }

      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "feedstocks" && q.queryKey[1] === "stats",
      });
      queryClient.invalidateQueries({ queryKey: storageLocationKeys.all });
      invalidateStockEntityQueries(queryClient, "feedstock");
      queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      // Feedstock writes resync the derived transport leg (distance/provenance),
      // an input to certification readiness.
      void invalidateCertificationReadiness(queryClient);
      invalidateOnboardingProgress(queryClient, variables.facilityId);
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
  });
}

export function useUpdateFeedstock(callbacks?: MutationCallbacks<FeedstockWithRelations, UpdateFeedstockData>) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: recordLockMeta(RECORD_LOCK_TOUCHES.feedstock),
    mutationFn: async (data: UpdateFeedstockData) => {
      const result = await updateFeedstockFn(data);
      // Keeps an expected-version refusal typed so the open edit form can show
      // it and hold on to the operator's draft (issue #768).
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "feedstocks" && q.queryKey[1] === "stats",
      });
      queryClient.invalidateQueries({ queryKey: storageLocationKeys.all });
      invalidateStockEntityQueries(queryClient, "feedstock");
      queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      // Feedstock writes resync the derived transport leg (distance/provenance),
      // an input to certification readiness.
      void invalidateCertificationReadiness(queryClient);
      callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
  });
}

export function useDeleteFeedstock(callbacks?: MutationCallbacks<void, DeleteFeedstockData>) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: recordLockMeta(RECORD_LOCK_TOUCHES.feedstock),
    mutationFn: async (data: DeleteFeedstockData) => {
      const result = await deleteFeedstockFn(data);
      if (!result.success) throwActionError(result);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "feedstocks" && q.queryKey[1] === "stats",
      });
      queryClient.invalidateQueries({ queryKey: storageLocationKeys.all });
      invalidateStockEntityQueries(queryClient, "feedstock");
      queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      // Feedstock writes resync the derived transport leg (distance/provenance),
      // an input to certification readiness.
      void invalidateCertificationReadiness(queryClient);
      callbacks?.onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      if (error instanceof StaleVersionError) {
        queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
        queryClient.invalidateQueries({ queryKey: feedstockKeys.detail(variables.feedstockId) });
      }
      return callbacks?.onError?.(error, variables);
    },
  });
}
