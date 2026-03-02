/**
 * Suppliers React Query Hooks
 * Client-side state management for supplier operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Supplier } from "@/db/schema";
import type {
  SupplierFilterData,
  CreateSupplierData,
  UpdateSupplierData,
} from "@/schemas/suppliers";
import type {
  PaginatedSuppliers,
  SupplierWithRelations,
} from "@/data-access/suppliers";
import {
  getSuppliersFn,
  getSupplierByIdFn,
  getSupplierLocationsFn,
  getSupplierOptionsFn,
  checkSupplierCodeFn,
  createSupplierFn,
  updateSupplierFn,
  deleteSupplierFn,
} from "@/fn/suppliers";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";

// ============================================
// Query Keys
// ============================================

export const supplierKeys = {
  all: ["suppliers"] as const,
  lists: () => [...supplierKeys.all, "list"] as const,
  list: (filters?: Partial<SupplierFilterData>) =>
    [...supplierKeys.lists(), filters] as const,
  details: () => [...supplierKeys.all, "detail"] as const,
  detail: (id: string) => [...supplierKeys.details(), id] as const,
  locations: () => [...supplierKeys.all, "locations"] as const,
  options: () => [...supplierKeys.all, "options"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...supplierKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Supplier Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of suppliers with filtering
 */
export function useSuppliers(filters?: Partial<SupplierFilterData>) {
  return useQuery({
    queryKey: supplierKeys.list(filters),
    queryFn: async () => {
      const result = await getSuppliersFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single supplier by ID
 */
export function useSupplier(supplierId: string, enabled = true) {
  return useQuery({
    queryKey: supplierKeys.detail(supplierId),
    queryFn: async () => {
      const result = await getSupplierByIdFn(supplierId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!supplierId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch unique locations from all suppliers
 */
export function useSupplierLocations() {
  return useQuery({
    queryKey: supplierKeys.locations(),
    queryFn: async () => {
      const result = await getSupplierLocationsFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute - locations don't change often
  });
}

/**
 * Hook to fetch supplier options for dropdowns
 */
export function useSupplierOptions() {
  return useQuery({
    queryKey: supplierKeys.options(),
    queryFn: async () => {
      const result = await getSupplierOptionsFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to check if a supplier code is available
 */
export function useSupplierCodeCheck(
  code: string,
  excludeSupplierId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: supplierKeys.codeCheck(code, excludeSupplierId),
    queryFn: async () => {
      const result = await checkSupplierCodeFn(code, excludeSupplierId);
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
// Supplier Mutation Hooks
// ============================================

/**
 * Hook to create a new supplier
 * Supports optional callbacks for custom behavior
 */
export function useCreateSupplier(
  callbacks?: MutationCallbacks<Supplier, CreateSupplierData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSupplierData) => {
      const result = await createSupplierFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all supplier lists
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() });
      // Invalidate locations in case a new location was added
      queryClient.invalidateQueries({ queryKey: supplierKeys.locations() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: supplierKeys.options() });

      // Pre-populate the detail cache with the new supplier
      queryClient.setQueryData(supplierKeys.detail(data.id), data);

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
 * Hook to update an existing supplier
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateSupplier(
  callbacks?: MutationCallbacks<Supplier, UpdateSupplierData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateSupplierData) => {
      const result = await updateSupplierFn(data);
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
        queryKey: supplierKeys.detail(variables.supplierId),
      });
      await queryClient.cancelQueries({
        queryKey: supplierKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousSupplier = queryClient.getQueryData<Supplier>(
        supplierKeys.detail(variables.supplierId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedSuppliers>({
        queryKey: supplierKeys.lists(),
      });

      // Optimistically update the supplier detail cache
      if (previousSupplier) {
        queryClient.setQueryData<Supplier>(
          supplierKeys.detail(variables.supplierId),
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

      // Optimistically update supplier in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedSuppliers>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.supplierId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as SupplierWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousSupplier, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(supplierKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() });
      queryClient.invalidateQueries({ queryKey: supplierKeys.locations() });
      queryClient.invalidateQueries({ queryKey: supplierKeys.options() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousSupplier, previousLists } = context as {
          previousSupplier?: Supplier;
          previousLists?: [readonly unknown[], PaginatedSuppliers | undefined][];
        };

        if (previousSupplier) {
          queryClient.setQueryData(
            supplierKeys.detail(variables.supplierId),
            previousSupplier
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
        queryKey: supplierKeys.detail(variables.supplierId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a supplier
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteSupplier(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (supplierId: string) => {
      const result = await deleteSupplierFn({ supplierId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (supplierId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(supplierId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: supplierKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousSupplier = queryClient.getQueryData<Supplier>(
        supplierKeys.detail(supplierId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedSuppliers>({
        queryKey: supplierKeys.lists(),
      });

      // Optimistically remove supplier from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedSuppliers>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== supplierId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(supplierId);

      // Return context with snapshots for rollback
      return { previousSupplier, previousLists };
    },
    onSuccess: async (_, supplierId) => {
      // Remove specific supplier from cache
      queryClient.removeQueries({ queryKey: supplierKeys.detail(supplierId) });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() });
      // Invalidate locations in case the deleted supplier was the only one with its location
      queryClient.invalidateQueries({ queryKey: supplierKeys.locations() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: supplierKeys.options() });

      await callbacks?.onSuccess?.(undefined, supplierId);
    },
    onError: async (error, supplierId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousSupplier, previousLists } = context as {
          previousSupplier?: Supplier;
          previousLists?: [readonly unknown[], PaginatedSuppliers | undefined][];
        };

        if (previousSupplier) {
          queryClient.setQueryData(
            supplierKeys.detail(supplierId),
            previousSupplier
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, supplierId);
    },
    onSettled: async (data, error, supplierId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() });

      await callbacks?.onSettled?.(data, error, supplierId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch suppliers list for faster initial load
 */
export function usePrefetchSuppliers() {
  const queryClient = useQueryClient();

  return (filters?: Partial<SupplierFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: supplierKeys.list(filters),
      queryFn: async () => {
        const result = await getSuppliersFn(filters);
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
 * Prefetch a single supplier
 */
export function usePrefetchSupplier() {
  const queryClient = useQueryClient();

  return (supplierId: string) => {
    queryClient.prefetchQuery({
      queryKey: supplierKeys.detail(supplierId),
      queryFn: async () => {
        const result = await getSupplierByIdFn(supplierId);
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
 * Hook to access supplier cache invalidation functions
 * Useful for manual cache control from components
 */
export function useSupplierCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all supplier data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: supplierKeys.all }),

    /** Invalidate all supplier lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() }),

    /** Invalidate a specific supplier detail */
    invalidateDetail: (supplierId: string) =>
      queryClient.invalidateQueries({
        queryKey: supplierKeys.detail(supplierId),
      }),

    /** Invalidate supplier locations list */
    invalidateLocations: () =>
      queryClient.invalidateQueries({ queryKey: supplierKeys.locations() }),

    /** Invalidate supplier options */
    invalidateOptions: () =>
      queryClient.invalidateQueries({ queryKey: supplierKeys.options() }),

    /** Remove a specific supplier from cache (use after deletion) */
    removeFromCache: (supplierId: string) => {
      queryClient.removeQueries({ queryKey: supplierKeys.detail(supplierId) });
    },

    /** Set supplier data in cache (useful for optimistic updates) */
    setSupplierData: (supplierId: string, data: Supplier) =>
      queryClient.setQueryData(supplierKeys.detail(supplierId), data),

    /** Get cached supplier data */
    getCachedSupplier: (supplierId: string) =>
      queryClient.getQueryData<Supplier>(supplierKeys.detail(supplierId)),
  };
}
