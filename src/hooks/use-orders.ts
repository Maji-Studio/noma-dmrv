/**
 * Orders React Query Hooks
 * Client-side state management for order operations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Order } from "@/db/schema";
import type {
  OrderFilterData,
  CreateOrderData,
  UpdateOrderData,
} from "@/schemas/orders";
import type { PaginatedOrders, OrderWithRelations } from "@/data-access/orders";
import {
  getOrdersFn,
  getOrderByIdFn,
  getOrderWithRelationsFn,
  getOrdersForSelectFn,
  checkOrderCodeFn,
  createOrderFn,
  updateOrderFn,
  deleteOrderFn,
} from "@/fn/orders";

// ============================================
// Types
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

// ============================================
// Query Keys
// ============================================

export const orderKeys = {
  all: ["orders"] as const,
  lists: () => [...orderKeys.all, "list"] as const,
  list: (filters?: Partial<OrderFilterData>) =>
    [...orderKeys.lists(), filters] as const,
  details: () => [...orderKeys.all, "detail"] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
  detailWithRelations: (id: string) =>
    [...orderKeys.details(), id, "relations"] as const,
  select: (facilityId?: string) =>
    [...orderKeys.all, "select", facilityId] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...orderKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of orders with filtering
 */
export function useOrders(filters?: Partial<OrderFilterData>) {
  return useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: async () => {
      const result = await getOrdersFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single order by ID
 */
export function useOrder(orderId: string, enabled = true) {
  return useQuery({
    queryKey: orderKeys.detail(orderId),
    queryFn: async () => {
      const result = await getOrderByIdFn(orderId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!orderId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch an order with all its relations
 */
export function useOrderWithRelations(orderId: string, enabled = true) {
  return useQuery({
    queryKey: orderKeys.detailWithRelations(orderId),
    queryFn: async () => {
      const result = await getOrderWithRelationsFn(orderId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!orderId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch orders for dropdown selection
 */
export function useOrdersForSelect(facilityId?: string) {
  return useQuery({
    queryKey: orderKeys.select(facilityId),
    queryFn: async () => {
      const result = await getOrdersForSelectFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000,
  });
}

/**
 * Hook to check if an order code is available
 */
export function useOrderCodeCheck(
  code: string,
  excludeOrderId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: orderKeys.codeCheck(code, excludeOrderId),
    queryFn: async () => {
      const result = await checkOrderCodeFn(code, excludeOrderId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data.available;
    },
    enabled: enabled && code.length > 0,
    staleTime: 5000, // 5 seconds - code availability can change quickly
  });
}

// ============================================
// Mutation Hooks
// ============================================

/**
 * Hook to create a new order
 */
export function useCreateOrder(
  callbacks?: MutationCallbacks<Order, CreateOrderData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateOrderData) => {
      const result = await createOrderFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all order lists
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      // Pre-populate the detail cache with the new order
      queryClient.setQueryData(orderKeys.detail(data.id), data);

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
 * Hook to update an existing order
 */
export function useUpdateOrder(
  callbacks?: MutationCallbacks<Order, UpdateOrderData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateOrderData) => {
      const result = await updateOrderFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: orderKeys.detail(variables.orderId),
      });
      await queryClient.cancelQueries({
        queryKey: orderKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousOrder = queryClient.getQueryData<Order>(
        orderKeys.detail(variables.orderId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedOrders>({
        queryKey: orderKeys.lists(),
      });

      // Optimistically update the order detail cache
      if (previousOrder) {
        queryClient.setQueryData<Order>(
          orderKeys.detail(variables.orderId),
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

      // Optimistically update order in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedOrders>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.orderId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as OrderWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      return { previousOrder, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(orderKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({
        queryKey: orderKeys.detailWithRelations(data.id),
      });
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (context) {
        const { previousOrder, previousLists } = context as {
          previousOrder?: Order;
          previousLists?: [readonly unknown[], PaginatedOrders | undefined][];
        };

        if (previousOrder) {
          queryClient.setQueryData(
            orderKeys.detail(variables.orderId),
            previousOrder
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
        queryKey: orderKeys.detail(variables.orderId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete an order
 */
export function useDeleteOrder(callbacks?: MutationCallbacks<void, string>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const result = await deleteOrderFn({ orderId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (orderId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: orderKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousOrder = queryClient.getQueryData<Order>(
        orderKeys.detail(orderId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedOrders>({
        queryKey: orderKeys.lists(),
      });

      // Optimistically remove order from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedOrders>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== orderId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(orderId);

      return { previousOrder, previousLists };
    },
    onSuccess: async (_, orderId) => {
      // Remove specific order from cache
      queryClient.removeQueries({ queryKey: orderKeys.detail(orderId) });
      queryClient.removeQueries({
        queryKey: orderKeys.detailWithRelations(orderId),
      });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });

      await callbacks?.onSuccess?.(undefined, orderId);
    },
    onError: async (error, orderId, context) => {
      // Rollback to previous values on error
      if (context) {
        const { previousOrder, previousLists } = context as {
          previousOrder?: Order;
          previousLists?: [readonly unknown[], PaginatedOrders | undefined][];
        };

        if (previousOrder) {
          queryClient.setQueryData(orderKeys.detail(orderId), previousOrder);
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, orderId);
    },
    onSettled: async (data, error, orderId) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });

      await callbacks?.onSettled?.(data, error, orderId);
    },
  });
}

// ============================================
// Cache Invalidation Utilities
// ============================================

/**
 * Hook to access order cache invalidation functions
 */
export function useOrderCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all order data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: orderKeys.all }),

    /** Invalidate all order lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() }),

    /** Invalidate a specific order detail */
    invalidateDetail: (orderId: string) =>
      queryClient.invalidateQueries({
        queryKey: orderKeys.detail(orderId),
      }),

    /** Invalidate an order with its relations */
    invalidateDetailWithRelations: (orderId: string) =>
      queryClient.invalidateQueries({
        queryKey: orderKeys.detailWithRelations(orderId),
      }),

    /** Remove a specific order from cache (use after deletion) */
    removeFromCache: (orderId: string) => {
      queryClient.removeQueries({ queryKey: orderKeys.detail(orderId) });
      queryClient.removeQueries({
        queryKey: orderKeys.detailWithRelations(orderId),
      });
    },
  };
}
