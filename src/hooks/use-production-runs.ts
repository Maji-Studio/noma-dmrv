/**
 * Production Runs React Query Hooks
 * Client-side state management for production run operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProductionRunFilterData,
  CreateProductionRunData,
  UpdateProductionRunData,
} from "@/schemas/production-runs";
import type {
  PaginatedProductionRuns,
  ProductionRunWithRelations,
  ProductionRunReadingRecord,
} from "@/data-access/production-runs";
import {
  getProductionRunsFn,
  getProductionRunByIdFn,
  getProductionRunStatsFn,
  getProductionRunReadingsFn,
  checkProductionRunCodeFn,
  createProductionRunFn,
  updateProductionRunFn,
  deleteProductionRunFn,
  addProductionRunReadingFn,
} from "@/fn/production-runs";
import { facilityKeys } from "@/hooks/use-facilities";
import { reactorKeys } from "@/hooks/use-reactors";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";

// ============================================
// Query Keys
// ============================================

export const productionRunKeys = {
  all: ["productionRuns"] as const,
  lists: () => [...productionRunKeys.all, "list"] as const,
  list: (filters?: Partial<ProductionRunFilterData>) =>
    [...productionRunKeys.lists(), filters] as const,
  details: () => [...productionRunKeys.all, "detail"] as const,
  detail: (id: string) => [...productionRunKeys.details(), id] as const,
  stats: (facilityId?: string) =>
    [...productionRunKeys.all, "stats", facilityId] as const,
  readings: (productionRunId: string) =>
    [...productionRunKeys.all, productionRunId, "readings"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...productionRunKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of production runs with filtering
 */
export function useProductionRuns(filters?: Partial<ProductionRunFilterData>) {
  return useQuery({
    queryKey: productionRunKeys.list(filters),
    queryFn: async () => {
      const result = await getProductionRunsFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single production run by ID
 */
export function useProductionRun(productionRunId: string, enabled = true) {
  return useQuery({
    queryKey: productionRunKeys.detail(productionRunId),
    queryFn: async () => {
      const result = await getProductionRunByIdFn(productionRunId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!productionRunId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch production run statistics
 */
export function useProductionRunStats(facilityId?: string, enabled = true) {
  return useQuery({
    queryKey: productionRunKeys.stats(facilityId),
    queryFn: async () => {
      const result = await getProductionRunStatsFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch production run readings (time-series data)
 */
export function useProductionRunReadings(
  productionRunId: string,
  enabled = true
) {
  return useQuery({
    queryKey: productionRunKeys.readings(productionRunId),
    queryFn: async () => {
      const result = await getProductionRunReadingsFn(productionRunId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!productionRunId,
    staleTime: 30000,
  });
}

/**
 * Hook to check if a production run code is available
 */
export function useProductionRunCodeCheck(
  code: string,
  excludeRunId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: productionRunKeys.codeCheck(code, excludeRunId),
    queryFn: async () => {
      const result = await checkProductionRunCodeFn(code, excludeRunId);
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
 * Hook to create a new production run
 * Supports optional callbacks for custom behavior
 */
export function useCreateProductionRun(
  callbacks?: MutationCallbacks<ProductionRunWithRelations, CreateProductionRunData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProductionRunData) => {
      const result = await createProductionRunFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all production run lists
      queryClient.invalidateQueries({ queryKey: productionRunKeys.lists() });
      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: productionRunKeys.stats() });
      // Invalidate facility detail (run count may have changed)
      queryClient.invalidateQueries({
        queryKey: facilityKeys.detail(data.facilityId),
      });
      // Invalidate reactor data
      queryClient.invalidateQueries({
        queryKey: reactorKeys.detail(data.reactorId),
      });

      // Pre-populate the detail cache with the new run
      queryClient.setQueryData(productionRunKeys.detail(data.id), data);

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
 * Hook to update an existing production run
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateProductionRun(
  callbacks?: MutationCallbacks<ProductionRunWithRelations, UpdateProductionRunData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateProductionRunData) => {
      const result = await updateProductionRunFn(data);
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
        queryKey: productionRunKeys.detail(variables.productionRunId),
      });
      await queryClient.cancelQueries({
        queryKey: productionRunKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousRun = queryClient.getQueryData<ProductionRunWithRelations>(
        productionRunKeys.detail(variables.productionRunId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedProductionRuns>({
        queryKey: productionRunKeys.lists(),
      });

      // Optimistically update the run detail cache
      if (previousRun) {
        queryClient.setQueryData<ProductionRunWithRelations>(
          productionRunKeys.detail(variables.productionRunId),
          (old) => {
            if (!old) return old;
            // Only update fields that can be safely merged
            return {
              ...old,
              code: variables.code ?? old.code,
              status: variables.status ?? old.status,
              biocharOutputKg: variables.biocharOutputKg ?? old.biocharOutputKg,
              updatedAt: new Date(),
            };
          }
        );
      }

      // Optimistically update run in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedProductionRuns>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) => {
              if (item.id !== variables.productionRunId) return item;
              // Only update fields that can be safely merged
              return {
                ...item,
                code: variables.code ?? item.code,
                status: variables.status ?? item.status,
                biocharOutputKg: variables.biocharOutputKg ?? item.biocharOutputKg,
                updatedAt: new Date(),
              };
            }),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousRun, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(productionRunKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: productionRunKeys.lists() });
      queryClient.invalidateQueries({ queryKey: productionRunKeys.stats() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousRun, previousLists } = context as {
          previousRun?: ProductionRunWithRelations;
          previousLists?: [readonly unknown[], PaginatedProductionRuns | undefined][];
        };

        if (previousRun) {
          queryClient.setQueryData(
            productionRunKeys.detail(variables.productionRunId),
            previousRun
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
        queryKey: productionRunKeys.detail(variables.productionRunId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a production run
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteProductionRun(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (productionRunId: string) => {
      const result = await deleteProductionRunFn({ productionRunId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (productionRunId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(productionRunId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: productionRunKeys.lists(),
      });

      // Snapshot previous values for rollback (capture facilityId before removing from cache)
      const previousRun = queryClient.getQueryData<ProductionRunWithRelations>(
        productionRunKeys.detail(productionRunId)
      );
      const facilityId = previousRun?.facilityId;
      const previousLists = queryClient.getQueriesData<PaginatedProductionRuns>({
        queryKey: productionRunKeys.lists(),
      });

      // Optimistically remove run from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedProductionRuns>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== productionRunId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(productionRunId);

      // Return context with snapshots for rollback
      return { previousRun, previousLists, facilityId };
    },
    onSuccess: async (_, productionRunId, context) => {
      const facilityId = (context as { facilityId?: string } | undefined)?.facilityId;

      // Remove specific run from cache
      queryClient.removeQueries({
        queryKey: productionRunKeys.detail(productionRunId),
      });
      queryClient.removeQueries({
        queryKey: productionRunKeys.readings(productionRunId),
      });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: productionRunKeys.lists() });
      // Invalidate stats
      queryClient.invalidateQueries({ queryKey: productionRunKeys.stats() });
      // Invalidate facility data
      if (facilityId) {
        queryClient.invalidateQueries({
          queryKey: facilityKeys.detail(facilityId),
        });
      }

      await callbacks?.onSuccess?.(undefined, productionRunId);
    },
    onError: async (error, productionRunId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousRun, previousLists } = context as {
          previousRun?: ProductionRunWithRelations;
          previousLists?: [readonly unknown[], PaginatedProductionRuns | undefined][];
        };

        if (previousRun) {
          queryClient.setQueryData(
            productionRunKeys.detail(productionRunId),
            previousRun
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, productionRunId);
    },
    onSettled: async (data, error, productionRunId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: productionRunKeys.lists() });

      await callbacks?.onSettled?.(data, error, productionRunId);
    },
  });
}

/**
 * Hook to add a reading to a production run
 */
export function useAddProductionRunReading(
  callbacks?: MutationCallbacks<
    ProductionRunReadingRecord,
    { productionRunId: string; timestamp: Date; temperatureC?: number | null; pressureBar?: number | null; gasFlowRate?: number | null }
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      productionRunId: string;
      timestamp: Date;
      temperatureC?: number | null;
      pressureBar?: number | null;
      gasFlowRate?: number | null;
    }) => {
      const result = await addProductionRunReadingFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: async (data, variables) => {
      // Invalidate readings cache
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.readings(variables.productionRunId),
      });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables) => {
      await callbacks?.onError?.(error, variables);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch production runs list for faster initial load
 */
export function usePrefetchProductionRuns() {
  const queryClient = useQueryClient();

  return (filters?: Partial<ProductionRunFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: productionRunKeys.list(filters),
      queryFn: async () => {
        const result = await getProductionRunsFn(filters);
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
 * Prefetch a single production run
 */
export function usePrefetchProductionRun() {
  const queryClient = useQueryClient();

  return (productionRunId: string) => {
    queryClient.prefetchQuery({
      queryKey: productionRunKeys.detail(productionRunId),
      queryFn: async () => {
        const result = await getProductionRunByIdFn(productionRunId);
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
 * Hook to access production run cache invalidation functions
 * Useful for manual cache control from components
 */
export function useProductionRunCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all production run data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: productionRunKeys.all }),

    /** Invalidate all production run lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: productionRunKeys.lists() }),

    /** Invalidate a specific production run detail */
    invalidateDetail: (productionRunId: string) =>
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.detail(productionRunId),
      }),

    /** Invalidate production run stats */
    invalidateStats: (facilityId?: string) =>
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.stats(facilityId),
      }),

    /** Invalidate readings for a production run */
    invalidateReadings: (productionRunId: string) =>
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.readings(productionRunId),
      }),

    /** Remove a specific production run from cache (use after deletion) */
    removeFromCache: (productionRunId: string) => {
      queryClient.removeQueries({
        queryKey: productionRunKeys.detail(productionRunId),
      });
      queryClient.removeQueries({
        queryKey: productionRunKeys.readings(productionRunId),
      });
    },

    /** Set production run data in cache (useful for optimistic updates) */
    setProductionRunData: (
      productionRunId: string,
      data: ProductionRunWithRelations
    ) => queryClient.setQueryData(productionRunKeys.detail(productionRunId), data),

    /** Get cached production run data */
    getCachedProductionRun: (productionRunId: string) =>
      queryClient.getQueryData<ProductionRunWithRelations>(
        productionRunKeys.detail(productionRunId)
      ),
  };
}
