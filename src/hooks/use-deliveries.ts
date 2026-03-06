/**
 * Deliveries React Query Hooks
 * Client-side state management for delivery operations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Delivery } from "@/db/schema";
import type {
  DeliveryFilterData,
  CreateDeliveryData,
  UpdateDeliveryData,
} from "@/schemas/deliveries";
import type {
  PaginatedDeliveries,
  DeliveryWithRelations,
} from "@/data-access/deliveries";
import {
  getDeliveriesFn,
  getDeliveryByIdFn,
  getDeliveryWithRelationsFn,
  getDeliveriesForSelectFn,
  getDeliveryStatsFn,
  getTransportLegsForDeliveryFn,
  checkDeliveryCodeFn,
  createDeliveryFn,
  updateDeliveryFn,
  deleteDeliveryFn,
} from "@/fn/deliveries";

import type { MutationCallbacks } from "./types";

// ============================================
// Query Keys
// ============================================

export const deliveryKeys = {
  all: ["deliveries"] as const,
  lists: () => [...deliveryKeys.all, "list"] as const,
  list: (filters?: Partial<DeliveryFilterData>) =>
    [...deliveryKeys.lists(), filters] as const,
  details: () => [...deliveryKeys.all, "detail"] as const,
  detail: (id: string) => [...deliveryKeys.details(), id] as const,
  detailWithRelations: (id: string) =>
    [...deliveryKeys.details(), id, "relations"] as const,
  select: (orderId?: string) =>
    [...deliveryKeys.all, "select", orderId] as const,
  stats: (filters?: { facilityId?: string; fromDate?: Date; toDate?: Date }) =>
    [...deliveryKeys.all, "stats", filters] as const,
  transportLegs: (deliveryId: string) =>
    [...deliveryKeys.all, "transportLegs", deliveryId] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...deliveryKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of deliveries with filtering
 */
export function useDeliveries(
  filters?: Partial<DeliveryFilterData>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: deliveryKeys.list(filters),
    queryFn: async () => {
      const result = await getDeliveriesFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
    enabled: options?.enabled,
  });
}

/**
 * Hook to fetch a single delivery by ID
 */
export function useDelivery(deliveryId: string, enabled = true) {
  return useQuery({
    queryKey: deliveryKeys.detail(deliveryId),
    queryFn: async () => {
      const result = await getDeliveryByIdFn(deliveryId);
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
 * Hook to fetch a delivery with all its relations
 */
export function useDeliveryWithRelations(deliveryId: string, enabled = true) {
  return useQuery({
    queryKey: deliveryKeys.detailWithRelations(deliveryId),
    queryFn: async () => {
      const result = await getDeliveryWithRelationsFn(deliveryId);
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
 * Hook to fetch delivery statistics
 */
export function useDeliveryStats(
  filters?: { facilityId?: string; fromDate?: Date; toDate?: Date },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: deliveryKeys.stats(filters),
    queryFn: async () => {
      const result = await getDeliveryStatsFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000,
    enabled: options?.enabled,
  });
}

/**
 * Hook to fetch transport legs for a delivery
 */
export function useTransportLegsForDelivery(deliveryId: string | undefined) {
  return useQuery({
    queryKey: deliveryKeys.transportLegs(deliveryId ?? ""),
    queryFn: async () => {
      const result = await getTransportLegsForDeliveryFn(deliveryId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!deliveryId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch deliveries for dropdown selection
 */
export function useDeliveriesForSelect(orderId?: string) {
  return useQuery({
    queryKey: deliveryKeys.select(orderId),
    queryFn: async () => {
      const result = await getDeliveriesForSelectFn(orderId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000,
  });
}

/**
 * Hook to check if a delivery code is available
 */
export function useDeliveryCodeCheck(
  code: string,
  excludeDeliveryId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: deliveryKeys.codeCheck(code, excludeDeliveryId),
    queryFn: async () => {
      const result = await checkDeliveryCodeFn(code, excludeDeliveryId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data.available;
    },
    enabled: enabled && code.length > 0,
    staleTime: 5000, // 5 seconds
  });
}

// ============================================
// Mutation Hooks
// ============================================

/**
 * Hook to create a new delivery
 */
export function useCreateDelivery(
  callbacks?: MutationCallbacks<Delivery, CreateDeliveryData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateDeliveryData) => {
      const result = await createDeliveryFn(data);
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
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() });
      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: deliveryKeys.stats() });
      // Pre-populate the detail cache with the new delivery
      queryClient.setQueryData(deliveryKeys.detail(data.id), data);

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
 * Hook to update an existing delivery
 */
export function useUpdateDelivery(
  callbacks?: MutationCallbacks<Delivery, UpdateDeliveryData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateDeliveryData) => {
      const result = await updateDeliveryFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: deliveryKeys.detail(variables.deliveryId),
      });
      await queryClient.cancelQueries({
        queryKey: deliveryKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousDelivery = queryClient.getQueryData<Delivery>(
        deliveryKeys.detail(variables.deliveryId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedDeliveries>({
        queryKey: deliveryKeys.lists(),
      });

      // Optimistically update the delivery detail cache
      if (previousDelivery) {
        queryClient.setQueryData<Delivery>(
          deliveryKeys.detail(variables.deliveryId),
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
        queryClient.setQueryData<PaginatedDeliveries>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.deliveryId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as DeliveryWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      return { previousDelivery, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(deliveryKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({
        queryKey: deliveryKeys.detailWithRelations(data.id),
      });
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: deliveryKeys.stats() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (context) {
        const { previousDelivery, previousLists } = context as {
          previousDelivery?: Delivery;
          previousLists?: [readonly unknown[], PaginatedDeliveries | undefined][];
        };

        if (previousDelivery) {
          queryClient.setQueryData(
            deliveryKeys.detail(variables.deliveryId),
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
      queryClient.invalidateQueries({
        queryKey: deliveryKeys.detail(variables.deliveryId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a delivery
 */
export function useDeleteDelivery(callbacks?: MutationCallbacks<void, string>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const result = await deleteDeliveryFn({ deliveryId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (deliveryId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: deliveryKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousDelivery = queryClient.getQueryData<Delivery>(
        deliveryKeys.detail(deliveryId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedDeliveries>({
        queryKey: deliveryKeys.lists(),
      });

      // Optimistically remove delivery from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedDeliveries>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== deliveryId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(deliveryId);

      return { previousDelivery, previousLists };
    },
    onSuccess: async (_, deliveryId) => {
      // Remove specific delivery from cache
      queryClient.removeQueries({ queryKey: deliveryKeys.detail(deliveryId) });
      queryClient.removeQueries({
        queryKey: deliveryKeys.detailWithRelations(deliveryId),
      });
      // Invalidate lists and stats for consistency
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: deliveryKeys.stats() });

      await callbacks?.onSuccess?.(undefined, deliveryId);
    },
    onError: async (error, deliveryId, context) => {
      // Rollback to previous values on error
      if (context) {
        const { previousDelivery, previousLists } = context as {
          previousDelivery?: Delivery;
          previousLists?: [readonly unknown[], PaginatedDeliveries | undefined][];
        };

        if (previousDelivery) {
          queryClient.setQueryData(
            deliveryKeys.detail(deliveryId),
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
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() });

      await callbacks?.onSettled?.(data, error, deliveryId);
    },
  });
}

// ============================================
// Cache Invalidation Utilities
// ============================================

/**
 * Hook to access delivery cache invalidation functions
 */
export function useDeliveryCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all delivery data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: deliveryKeys.all }),

    /** Invalidate all delivery lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() }),

    /** Invalidate delivery statistics */
    invalidateStats: () =>
      queryClient.invalidateQueries({ queryKey: deliveryKeys.stats() }),

    /** Invalidate a specific delivery detail */
    invalidateDetail: (deliveryId: string) =>
      queryClient.invalidateQueries({
        queryKey: deliveryKeys.detail(deliveryId),
      }),

    /** Invalidate a delivery with its relations */
    invalidateDetailWithRelations: (deliveryId: string) =>
      queryClient.invalidateQueries({
        queryKey: deliveryKeys.detailWithRelations(deliveryId),
      }),

    /** Remove a specific delivery from cache (use after deletion) */
    removeFromCache: (deliveryId: string) => {
      queryClient.removeQueries({ queryKey: deliveryKeys.detail(deliveryId) });
      queryClient.removeQueries({
        queryKey: deliveryKeys.detailWithRelations(deliveryId),
      });
    },
  };
}
