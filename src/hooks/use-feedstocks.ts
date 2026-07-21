/**
 * Feedstock React Query Hooks
 * Client-side state management for the unified delivery + bin allocation workflow.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FeedstockFilterData,
  CreateFeedstockData,
  UpdateFeedstockData,
} from "@/schemas/feedstocks";
import type {
  FeedstockWithRelations,
  CreateFeedstockResult,
} from "@/data-access/feedstocks";
import {
  getFeedstocksFn,
  getFeedstockByIdFn,
  getFeedstockStatsFn,
  getFeedstockOptionsFn,
  checkFeedstockCodeFn,
  createFeedstockFn,
  updateFeedstockFn,
  deleteFeedstockFn,
} from "@/fn/feedstocks";
import { storageLocationKeys } from "./use-storage-locations";
import type { MutationCallbacks } from "./types";
import { dashboardOverviewKeys } from "./use-dashboard-overview";

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
  stats: (facilityId?: string) => [...feedstockKeys.all, "stats", facilityId] as const,
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
    queryFn: async () => {
      const result = await getFeedstocksFn(filters);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30000,
    enabled: options?.enabled,
  });
}

export function useFeedstock(feedstockId: string, enabled = true) {
  return useQuery({
    queryKey: feedstockKeys.detail(feedstockId),
    queryFn: async () => {
      const result = await getFeedstockByIdFn(feedstockId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!feedstockId,
    staleTime: 30000,
  });
}

export function useFeedstockStats(
  facilityId?: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: feedstockKeys.stats(facilityId),
    queryFn: async () => {
      const result = await getFeedstockStatsFn(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30000,
    enabled: options?.enabled,
  });
}

export function useFeedstockOptions() {
  return useQuery({
    queryKey: feedstockKeys.options(),
    queryFn: async () => {
      const result = await getFeedstockOptionsFn();
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: 300000, // 5 min
  });
}

export function useFeedstockCodeCheck(code: string, excludeId?: string) {
  return useQuery({
    queryKey: feedstockKeys.codeCheck(code, excludeId),
    queryFn: async () => {
      const result = await checkFeedstockCodeFn(code, excludeId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: code.length >= 3,
    staleTime: 10000,
  });
}

// ============================================
// Mutation Hooks
// ============================================

export function useCreateFeedstock(callbacks?: MutationCallbacks<CreateFeedstockResult, CreateFeedstockData>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFeedstockData) => {
      const result = await createFeedstockFn(data);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "feedstocks" && q.queryKey[1] === "stats",
      });
      queryClient.invalidateQueries({ queryKey: storageLocationKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
  });
}

export function useUpdateFeedstock(callbacks?: MutationCallbacks<FeedstockWithRelations, UpdateFeedstockData>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateFeedstockData) => {
      const result = await updateFeedstockFn(data);
      if (!result.success) throw new Error(result.error);
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
      queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
  });
}

export function useDeleteFeedstock(callbacks?: MutationCallbacks<void, string>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (feedstockId: string) => {
      const result = await deleteFeedstockFn({ feedstockId });
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "feedstocks" && q.queryKey[1] === "stats",
      });
      queryClient.invalidateQueries({ queryKey: storageLocationKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: callbacks?.onError,
  });
}
