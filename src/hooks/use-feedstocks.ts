/**
 * Feedstocks React Query Hooks
 * Client-side state management for feedstock operations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FeedstockFilterData,
  CreateFeedstockData,
  UpdateFeedstockData,
} from "@/schemas/feedstocks";
import type {
  PaginatedFeedstocks,
  FeedstockWithRelations,
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

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";

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
// Feedstock Query Hooks
// ============================================

export function useFeedstocks(filters?: Partial<FeedstockFilterData>) {
  return useQuery({
    queryKey: feedstockKeys.list(filters),
    queryFn: async () => {
      const result = await getFeedstocksFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000,
  });
}

export function useFeedstock(feedstockId: string, enabled = true) {
  return useQuery({
    queryKey: feedstockKeys.detail(feedstockId),
    queryFn: async () => {
      const result = await getFeedstockByIdFn(feedstockId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!feedstockId,
    staleTime: 30000,
  });
}

export function useFeedstockStats(facilityId?: string) {
  return useQuery({
    queryKey: feedstockKeys.stats(facilityId),
    queryFn: async () => {
      const result = await getFeedstockStatsFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000,
  });
}

export function useFeedstockOptions() {
  return useQuery({
    queryKey: feedstockKeys.options(),
    queryFn: async () => {
      const result = await getFeedstockOptionsFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000,
  });
}

export function useFeedstockCodeCheck(
  code: string,
  excludeFeedstockId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: feedstockKeys.codeCheck(code, excludeFeedstockId),
    queryFn: async () => {
      const result = await checkFeedstockCodeFn(code, excludeFeedstockId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data.available;
    },
    enabled: enabled && code.length > 0,
    staleTime: 5000,
  });
}

// ============================================
// Feedstock Mutation Hooks
// ============================================

export function useCreateFeedstock(
  callbacks?: MutationCallbacks<FeedstockWithRelations, CreateFeedstockData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFeedstockData) => {
      const result = await createFeedstockFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.stats() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      queryClient.setQueryData(feedstockKeys.detail(data.id), data);
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

export function useUpdateFeedstock(
  callbacks?: MutationCallbacks<FeedstockWithRelations, UpdateFeedstockData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateFeedstockData) => {
      const result = await updateFeedstockFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(variables);
        return;
      }

      await queryClient.cancelQueries({
        queryKey: feedstockKeys.detail(variables.feedstockId),
      });
      await queryClient.cancelQueries({
        queryKey: feedstockKeys.lists(),
      });

      const previousFeedstock = queryClient.getQueryData<FeedstockWithRelations>(
        feedstockKeys.detail(variables.feedstockId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedFeedstocks>({
        queryKey: feedstockKeys.lists(),
      });

      if (previousFeedstock) {
        queryClient.setQueryData<FeedstockWithRelations>(
          feedstockKeys.detail(variables.feedstockId),
          (old) =>
            old
              ? { ...old, ...variables, updatedAt: new Date() }
              : old
        );
      }

      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedFeedstocks>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.feedstockId
                ? ({ ...item, ...variables, updatedAt: new Date() } as FeedstockWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);
      return { previousFeedstock, previousLists };
    },
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(feedstockKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.stats() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      if (optimistic && context) {
        const { previousFeedstock, previousLists } = context as {
          previousFeedstock?: FeedstockWithRelations;
          previousLists?: [readonly unknown[], PaginatedFeedstocks | undefined][];
        };

        if (previousFeedstock) {
          queryClient.setQueryData(
            feedstockKeys.detail(variables.feedstockId),
            previousFeedstock
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, variables);
    },
    onSettled: async (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: feedstockKeys.detail(variables.feedstockId),
      });
      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

export function useDeleteFeedstock(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (feedstockId: string) => {
      const result = await deleteFeedstockFn({ feedstockId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (feedstockId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(feedstockId);
        return;
      }

      await queryClient.cancelQueries({
        queryKey: feedstockKeys.lists(),
      });

      const previousFeedstock = queryClient.getQueryData<FeedstockWithRelations>(
        feedstockKeys.detail(feedstockId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedFeedstocks>({
        queryKey: feedstockKeys.lists(),
      });

      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedFeedstocks>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== feedstockId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(feedstockId);
      return { previousFeedstock, previousLists };
    },
    onSuccess: async (_, feedstockId) => {
      queryClient.removeQueries({ queryKey: feedstockKeys.detail(feedstockId) });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.stats() });
      queryClient.invalidateQueries({ queryKey: feedstockKeys.options() });
      await callbacks?.onSuccess?.(undefined, feedstockId);
    },
    onError: async (error, feedstockId, context) => {
      if (optimistic && context) {
        const { previousFeedstock, previousLists } = context as {
          previousFeedstock?: FeedstockWithRelations;
          previousLists?: [readonly unknown[], PaginatedFeedstocks | undefined][];
        };

        if (previousFeedstock) {
          queryClient.setQueryData(
            feedstockKeys.detail(feedstockId),
            previousFeedstock
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, feedstockId);
    },
    onSettled: async (data, error, feedstockId) => {
      queryClient.invalidateQueries({ queryKey: feedstockKeys.lists() });
      await callbacks?.onSettled?.(data, error, feedstockId);
    },
  });
}
