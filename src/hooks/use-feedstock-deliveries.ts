/**
 * Feedstock Deliveries React Query Hooks
 * Client-side state management for feedstock delivery operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FeedstockDeliveryFilterData,
  CreateFeedstockDeliveryData,
  UpdateFeedstockDeliveryData,
} from "@/schemas/feedstock-deliveries";
import type {
  PaginatedFeedstockDeliveries,
  FeedstockDeliveryWithRelations,
} from "@/data-access/feedstock-deliveries";
import {
  getFeedstockDeliveriesFn,
  getFeedstockDeliveryByIdFn,
  getFeedstockDeliveryStatsFn,
  getFeedstockDeliveryOptionsFn,
  checkFeedstockDeliveryCodeFn,
  generateNextDeliveryCodeFn,
  createFeedstockDeliveryFn,
  updateFeedstockDeliveryFn,
  deleteFeedstockDeliveryFn,
} from "@/fn/feedstock-deliveries";

// ============================================
// Types for Optimistic Updates
// ============================================

export interface MutationCallbacks<TData, TVariables> {
  onMutate?: (variables: TVariables) => void | Promise<void>;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables) => void | Promise<void>;
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables
  ) => void | Promise<void>;
}

export interface OptimisticUpdateOptions {
  /** Enable optimistic updates (default: true for update, false for create/delete) */
  optimistic?: boolean;
}

// ============================================
// Query Keys
// ============================================

export const feedstockDeliveryKeys = {
  all: ["feedstock-deliveries"] as const,
  lists: () => [...feedstockDeliveryKeys.all, "list"] as const,
  list: (filters?: Partial<FeedstockDeliveryFilterData>) =>
    [...feedstockDeliveryKeys.lists(), filters] as const,
  details: () => [...feedstockDeliveryKeys.all, "detail"] as const,
  detail: (id: string) => [...feedstockDeliveryKeys.details(), id] as const,
  stats: (facilityId?: string) => [...feedstockDeliveryKeys.all, "stats", facilityId] as const,
  options: () => [...feedstockDeliveryKeys.all, "options"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...feedstockDeliveryKeys.all, "codeCheck", code, excludeId] as const,
  nextCode: () => [...feedstockDeliveryKeys.all, "nextCode"] as const,
};

// ============================================
// Feedstock Delivery Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of feedstock deliveries with filtering
 */
export function useFeedstockDeliveries(filters?: Partial<FeedstockDeliveryFilterData>) {
  return useQuery({
    queryKey: feedstockDeliveryKeys.list(filters),
    queryFn: async () => {
      const result = await getFeedstockDeliveriesFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single feedstock delivery by ID
 */
export function useFeedstockDelivery(deliveryId: string, enabled = true) {
  return useQuery({
    queryKey: feedstockDeliveryKeys.detail(deliveryId),
    queryFn: async () => {
      const result = await getFeedstockDeliveryByIdFn(deliveryId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!deliveryId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch feedstock delivery statistics
 */
export function useFeedstockDeliveryStats(facilityId?: string) {
  return useQuery({
    queryKey: feedstockDeliveryKeys.stats(facilityId),
    queryFn: async () => {
      const result = await getFeedstockDeliveryStatsFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute - stats don't need to be real-time
  });
}

/**
 * Hook to fetch feedstock delivery options for dropdowns
 */
export function useFeedstockDeliveryOptions() {
  return useQuery({
    queryKey: feedstockDeliveryKeys.options(),
    queryFn: async () => {
      const result = await getFeedstockDeliveryOptionsFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to check if a feedstock delivery code is available
 */
export function useFeedstockDeliveryCodeCheck(
  code: string,
  excludeDeliveryId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: feedstockDeliveryKeys.codeCheck(code, excludeDeliveryId),
    queryFn: async () => {
      const result = await checkFeedstockDeliveryCodeFn(code, excludeDeliveryId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data.available;
    },
    enabled: enabled && code.length > 0,
    staleTime: 5000, // 5 seconds - code availability can change quickly
  });
}

/**
 * Hook to generate next delivery code
 */
export function useGenerateNextDeliveryCode() {
  return useQuery({
    queryKey: feedstockDeliveryKeys.nextCode(),
    queryFn: async () => {
      const result = await generateNextDeliveryCodeFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 0, // Always fetch fresh code
  });
}

// ============================================
// Feedstock Delivery Mutation Hooks
// ============================================

/**
 * Hook to create a new feedstock delivery
 * Supports optional callbacks for custom behavior
 */
export function useCreateFeedstockDelivery(
  callbacks?: MutationCallbacks<FeedstockDeliveryWithRelations, CreateFeedstockDeliveryData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFeedstockDeliveryData) => {
      const result = await createFeedstockDeliveryFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all delivery lists
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.lists() });
      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.stats() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.options() });
      // Invalidate next code
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.nextCode() });

      // Pre-populate the detail cache with the new delivery
      queryClient.setQueryData(feedstockDeliveryKeys.detail(data.id), data);

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

/**
 * Hook to update an existing feedstock delivery
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateFeedstockDelivery(
  callbacks?: MutationCallbacks<FeedstockDeliveryWithRelations, UpdateFeedstockDeliveryData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateFeedstockDeliveryData) => {
      const result = await updateFeedstockDeliveryFn(data);
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

      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: feedstockDeliveryKeys.detail(variables.deliveryId),
      });
      await queryClient.cancelQueries({
        queryKey: feedstockDeliveryKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousDelivery = queryClient.getQueryData<FeedstockDeliveryWithRelations>(
        feedstockDeliveryKeys.detail(variables.deliveryId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedFeedstockDeliveries>({
        queryKey: feedstockDeliveryKeys.lists(),
      });

      // Optimistically update the delivery detail cache
      if (previousDelivery) {
        queryClient.setQueryData<FeedstockDeliveryWithRelations>(
          feedstockDeliveryKeys.detail(variables.deliveryId),
          (old) =>
            old
              ? {
                  ...old,
                  ...variables,
                  updatedAt: new Date(),
                }
              : old
        );
      }

      // Optimistically update delivery in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedFeedstockDeliveries>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.deliveryId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as FeedstockDeliveryWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousDelivery, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(feedstockDeliveryKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.stats() });
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.options() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousDelivery, previousLists } = context as {
          previousDelivery?: FeedstockDeliveryWithRelations;
          previousLists?: [readonly unknown[], PaginatedFeedstockDeliveries | undefined][];
        };

        if (previousDelivery) {
          queryClient.setQueryData(
            feedstockDeliveryKeys.detail(variables.deliveryId),
            previousDelivery
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
      // Refetch to ensure cache consistency after mutation settles
      queryClient.invalidateQueries({
        queryKey: feedstockDeliveryKeys.detail(variables.deliveryId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a feedstock delivery
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteFeedstockDelivery(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const result = await deleteFeedstockDeliveryFn({ deliveryId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (deliveryId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(deliveryId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: feedstockDeliveryKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousDelivery = queryClient.getQueryData<FeedstockDeliveryWithRelations>(
        feedstockDeliveryKeys.detail(deliveryId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedFeedstockDeliveries>({
        queryKey: feedstockDeliveryKeys.lists(),
      });

      // Optimistically remove delivery from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedFeedstockDeliveries>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== deliveryId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(deliveryId);

      // Return context with snapshots for rollback
      return { previousDelivery, previousLists };
    },
    onSuccess: async (_, deliveryId) => {
      // Remove specific delivery from cache
      queryClient.removeQueries({ queryKey: feedstockDeliveryKeys.detail(deliveryId) });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.lists() });
      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.stats() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.options() });

      await callbacks?.onSuccess?.(undefined, deliveryId);
    },
    onError: async (error, deliveryId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousDelivery, previousLists } = context as {
          previousDelivery?: FeedstockDeliveryWithRelations;
          previousLists?: [readonly unknown[], PaginatedFeedstockDeliveries | undefined][];
        };

        if (previousDelivery) {
          queryClient.setQueryData(
            feedstockDeliveryKeys.detail(deliveryId),
            previousDelivery
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, deliveryId);
    },
    onSettled: async (data, error, deliveryId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.lists() });

      await callbacks?.onSettled?.(data, error, deliveryId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch feedstock deliveries list for faster initial load
 */
export function usePrefetchFeedstockDeliveries() {
  const queryClient = useQueryClient();

  return (filters?: Partial<FeedstockDeliveryFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: feedstockDeliveryKeys.list(filters),
      queryFn: async () => {
        const result = await getFeedstockDeliveriesFn(filters);
        if (!result.success) {
          throw new Error(result.error);
        }
        return result.data;
      },
      staleTime: 30000,
    });
  };
}

/**
 * Prefetch a single feedstock delivery
 */
export function usePrefetchFeedstockDelivery() {
  const queryClient = useQueryClient();

  return (deliveryId: string) => {
    queryClient.prefetchQuery({
      queryKey: feedstockDeliveryKeys.detail(deliveryId),
      queryFn: async () => {
        const result = await getFeedstockDeliveryByIdFn(deliveryId);
        if (!result.success) {
          throw new Error(result.error);
        }
        return result.data;
      },
      staleTime: 30000,
    });
  };
}

// ============================================
// Cache Invalidation Utilities
// ============================================

/**
 * Hook to access feedstock delivery cache invalidation functions
 * Useful for manual cache control from components
 */
export function useFeedstockDeliveryCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all feedstock delivery data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.all }),

    /** Invalidate all feedstock delivery lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.lists() }),

    /** Invalidate a specific feedstock delivery detail */
    invalidateDetail: (deliveryId: string) =>
      queryClient.invalidateQueries({
        queryKey: feedstockDeliveryKeys.detail(deliveryId),
      }),

    /** Invalidate stats */
    invalidateStats: (facilityId?: string) =>
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.stats(facilityId) }),

    /** Invalidate feedstock delivery options */
    invalidateOptions: () =>
      queryClient.invalidateQueries({ queryKey: feedstockDeliveryKeys.options() }),

    /** Remove a specific feedstock delivery from cache (use after deletion) */
    removeFromCache: (deliveryId: string) => {
      queryClient.removeQueries({ queryKey: feedstockDeliveryKeys.detail(deliveryId) });
    },

    /** Set feedstock delivery data in cache (useful for optimistic updates) */
    setDeliveryData: (deliveryId: string, data: FeedstockDeliveryWithRelations) =>
      queryClient.setQueryData(feedstockDeliveryKeys.detail(deliveryId), data),

    /** Get cached feedstock delivery data */
    getCachedDelivery: (deliveryId: string) =>
      queryClient.getQueryData<FeedstockDeliveryWithRelations>(feedstockDeliveryKeys.detail(deliveryId)),
  };
}
