/**
 * Customers React Query Hooks
 * Client-side state management for customer and customer location operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer, CustomerLocation } from "@/db/schema";
import type {
  CustomerFilterData,
  CreateCustomerData,
  UpdateCustomerData,
  CreateCustomerLocationData,
  UpdateCustomerLocationData,
} from "@/schemas/customers";
import type {
  PaginatedCustomers,
  CustomerWithRelations,
} from "@/data-access/customers";
import {
  getCustomersFn,
  getCustomerByIdFn,
  getCustomerWithRelationsFn,
  getCustomerLocationsFn,
  getCustomerCropTypesFn,
  checkCustomerCodeFn,
  createCustomerFn,
  updateCustomerFn,
  deleteCustomerFn,
  getCustomerLocationByIdFn,
  createCustomerLocationFn,
  updateCustomerLocationFn,
  deleteCustomerLocationFn,
} from "@/fn/customers";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";

// ============================================
// Query Keys
// ============================================

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (filters?: Partial<CustomerFilterData>) =>
    [...customerKeys.lists(), filters] as const,
  details: () => [...customerKeys.all, "detail"] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
  detailWithRelations: (id: string) =>
    [...customerKeys.details(), id, "relations"] as const,
  locations: (id: string) => [...customerKeys.all, id, "locations"] as const,
  cropTypes: () => [...customerKeys.all, "cropTypes"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...customerKeys.all, "codeCheck", code, excludeId] as const,
};

export const customerLocationKeys = {
  all: ["customerLocations"] as const,
  detail: (id: string) => [...customerLocationKeys.all, "detail", id] as const,
};

// ============================================
// Customer Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of customers with filtering
 */
export function useCustomers(filters?: Partial<CustomerFilterData>) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    queryFn: async () => {
      const result = await getCustomersFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single customer by ID
 */
export function useCustomer(customerId: string, enabled = true) {
  return useQuery({
    queryKey: customerKeys.detail(customerId),
    queryFn: async () => {
      const result = await getCustomerByIdFn(customerId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!customerId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch a customer with all its relations
 */
export function useCustomerWithRelations(customerId: string, enabled = true) {
  return useQuery({
    queryKey: customerKeys.detailWithRelations(customerId),
    queryFn: async () => {
      const result = await getCustomerWithRelationsFn(customerId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!customerId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch locations for a specific customer
 */
export function useCustomerLocations(customerId: string, enabled = true) {
  return useQuery({
    queryKey: customerKeys.locations(customerId),
    queryFn: async () => {
      const result = await getCustomerLocationsFn(customerId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!customerId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch unique crop types from all customers
 */
export function useCustomerCropTypes() {
  return useQuery({
    queryKey: customerKeys.cropTypes(),
    queryFn: async () => {
      const result = await getCustomerCropTypesFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute - crop types don't change often
  });
}

/**
 * Hook to check if a customer code is available
 */
export function useCustomerCodeCheck(
  code: string,
  excludeCustomerId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: customerKeys.codeCheck(code, excludeCustomerId),
    queryFn: async () => {
      const result = await checkCustomerCodeFn(code, excludeCustomerId);
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
// Customer Mutation Hooks
// ============================================

/**
 * Hook to create a new customer
 * Supports optional callbacks for custom behavior
 */
export function useCreateCustomer(
  callbacks?: MutationCallbacks<Customer, CreateCustomerData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCustomerData) => {
      const result = await createCustomerFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all customer lists
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      // Invalidate crop types in case a new crop type was added
      queryClient.invalidateQueries({ queryKey: customerKeys.cropTypes() });

      // Pre-populate the detail cache with the new customer
      queryClient.setQueryData(customerKeys.detail(data.id), data);

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
 * Hook to update an existing customer
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateCustomer(
  callbacks?: MutationCallbacks<Customer, UpdateCustomerData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateCustomerData) => {
      const result = await updateCustomerFn(data);
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
        queryKey: customerKeys.detail(variables.customerId),
      });
      await queryClient.cancelQueries({
        queryKey: customerKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousCustomer = queryClient.getQueryData<Customer>(
        customerKeys.detail(variables.customerId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedCustomers>({
        queryKey: customerKeys.lists(),
      });

      // Optimistically update the customer detail cache
      if (previousCustomer) {
        queryClient.setQueryData<Customer>(
          customerKeys.detail(variables.customerId),
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

      // Optimistically update customer in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedCustomers>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.customerId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as CustomerWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousCustomer, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(customerKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(data.id),
      });
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.invalidateQueries({ queryKey: customerKeys.cropTypes() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousCustomer, previousLists } = context as {
          previousCustomer?: Customer;
          previousLists?: [readonly unknown[], PaginatedCustomers | undefined][];
        };

        if (previousCustomer) {
          queryClient.setQueryData(
            customerKeys.detail(variables.customerId),
            previousCustomer
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
        queryKey: customerKeys.detail(variables.customerId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a customer
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteCustomer(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (customerId: string) => {
      const result = await deleteCustomerFn({ customerId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (customerId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(customerId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: customerKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousCustomer = queryClient.getQueryData<Customer>(
        customerKeys.detail(customerId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedCustomers>({
        queryKey: customerKeys.lists(),
      });

      // Optimistically remove customer from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedCustomers>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== customerId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(customerId);

      // Return context with snapshots for rollback
      return { previousCustomer, previousLists };
    },
    onSuccess: async (_, customerId) => {
      // Remove specific customer from cache
      queryClient.removeQueries({ queryKey: customerKeys.detail(customerId) });
      queryClient.removeQueries({
        queryKey: customerKeys.detailWithRelations(customerId),
      });
      queryClient.removeQueries({
        queryKey: customerKeys.locations(customerId),
      });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      // Invalidate crop types in case the deleted customer was the only one with its crop type
      queryClient.invalidateQueries({ queryKey: customerKeys.cropTypes() });

      await callbacks?.onSuccess?.(undefined, customerId);
    },
    onError: async (error, customerId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousCustomer, previousLists } = context as {
          previousCustomer?: Customer;
          previousLists?: [readonly unknown[], PaginatedCustomers | undefined][];
        };

        if (previousCustomer) {
          queryClient.setQueryData(
            customerKeys.detail(customerId),
            previousCustomer
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, customerId);
    },
    onSettled: async (data, error, customerId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });

      await callbacks?.onSettled?.(data, error, customerId);
    },
  });
}

// ============================================
// Customer Location Query Hooks
// ============================================

/**
 * Hook to fetch a single customer location by ID
 */
export function useCustomerLocation(locationId: string, enabled = true) {
  return useQuery({
    queryKey: customerLocationKeys.detail(locationId),
    queryFn: async () => {
      const result = await getCustomerLocationByIdFn(locationId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!locationId,
    staleTime: 30000,
  });
}

// ============================================
// Customer Location Mutation Hooks
// ============================================

/**
 * Hook to create a new customer location
 */
export function useCreateCustomerLocation(
  callbacks?: MutationCallbacks<CustomerLocation, CreateCustomerLocationData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCustomerLocationData) => {
      const result = await createCustomerLocationFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate customer locations list
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(variables.customerId),
      });
      // Invalidate customer detail with relations
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(variables.customerId),
      });
      // Invalidate customer lists (location count changed)
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });

      // Pre-populate the detail cache
      queryClient.setQueryData(customerLocationKeys.detail(data.id), data);

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
 * Hook to update a customer location
 */
export function useUpdateCustomerLocation(
  callbacks?: MutationCallbacks<CustomerLocation, UpdateCustomerLocationData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateCustomerLocationData) => {
      const result = await updateCustomerLocationFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(customerLocationKeys.detail(data.id), data);

      // Invalidate customer locations list
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(data.customerId),
      });
      // Invalidate customer detail with relations
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(data.customerId),
      });

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
 * Hook to delete a customer location
 */
export function useDeleteCustomerLocation(
  customerId: string,
  callbacks?: MutationCallbacks<void, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (locationId: string) => {
      const result = await deleteCustomerLocationFn({ locationId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (locationId) => {
      await callbacks?.onMutate?.(locationId);
    },
    onSuccess: async (_, locationId) => {
      // Remove from cache
      queryClient.removeQueries({
        queryKey: customerLocationKeys.detail(locationId),
      });
      // Invalidate customer locations list
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(customerId),
      });
      // Invalidate customer detail with relations
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(customerId),
      });
      // Invalidate customer lists (location count changed)
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });

      await callbacks?.onSuccess?.(undefined, locationId);
    },
    onError: async (error, locationId) => {
      await callbacks?.onError?.(error, locationId);
    },
    onSettled: async (data, error, locationId) => {
      await callbacks?.onSettled?.(data, error, locationId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch customers list for faster initial load
 */
export function usePrefetchCustomers() {
  const queryClient = useQueryClient();

  return (filters?: Partial<CustomerFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: customerKeys.list(filters),
      queryFn: async () => {
        const result = await getCustomersFn(filters);
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
 * Prefetch a single customer
 */
export function usePrefetchCustomer() {
  const queryClient = useQueryClient();

  return (customerId: string) => {
    queryClient.prefetchQuery({
      queryKey: customerKeys.detail(customerId),
      queryFn: async () => {
        const result = await getCustomerByIdFn(customerId);
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
 * Hook to access customer cache invalidation functions
 * Useful for manual cache control from components
 */
export function useCustomerCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all customer data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),

    /** Invalidate all customer lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() }),

    /** Invalidate a specific customer detail */
    invalidateDetail: (customerId: string) =>
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(customerId),
      }),

    /** Invalidate a customer with its relations */
    invalidateDetailWithRelations: (customerId: string) =>
      queryClient.invalidateQueries({
        queryKey: customerKeys.detailWithRelations(customerId),
      }),

    /** Invalidate customer locations */
    invalidateLocations: (customerId: string) =>
      queryClient.invalidateQueries({
        queryKey: customerKeys.locations(customerId),
      }),

    /** Invalidate crop types list */
    invalidateCropTypes: () =>
      queryClient.invalidateQueries({ queryKey: customerKeys.cropTypes() }),

    /** Remove a specific customer from cache (use after deletion) */
    removeFromCache: (customerId: string) => {
      queryClient.removeQueries({ queryKey: customerKeys.detail(customerId) });
      queryClient.removeQueries({
        queryKey: customerKeys.detailWithRelations(customerId),
      });
      queryClient.removeQueries({
        queryKey: customerKeys.locations(customerId),
      });
    },

    /** Set customer data in cache (useful for optimistic updates) */
    setCustomerData: (customerId: string, data: Customer) =>
      queryClient.setQueryData(customerKeys.detail(customerId), data),

    /** Get cached customer data */
    getCachedCustomer: (customerId: string) =>
      queryClient.getQueryData<Customer>(customerKeys.detail(customerId)),
  };
}
