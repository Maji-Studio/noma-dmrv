/**
 * Biochar Products React Query Hooks
 * Client-side state management for biochar product operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BiocharProduct } from "@/db/schema";
import type {
  BiocharProductFilterData,
  CreateBiocharProductData,
  UpdateBiocharProductData,
} from "@/schemas/biochar-products";
import type {
  PaginatedBiocharProducts,
  BiocharProductWithRelations,
} from "@/data-access/biochar-products";
import {
  getBiocharProductsFn,
  getBiocharProductByIdFn,
  getBiocharProductOptionsFn,
  checkBiocharProductCodeFn,
  createBiocharProductFn,
  updateBiocharProductFn,
  deleteBiocharProductFn,
} from "@/fn/biochar-products";

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

export const biocharProductKeys = {
  all: ["biocharProducts"] as const,
  lists: () => [...biocharProductKeys.all, "list"] as const,
  list: (filters?: Partial<BiocharProductFilterData>) =>
    [...biocharProductKeys.lists(), filters] as const,
  details: () => [...biocharProductKeys.all, "detail"] as const,
  detail: (id: string) => [...biocharProductKeys.details(), id] as const,
  options: () => [...biocharProductKeys.all, "options"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...biocharProductKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Biochar Product Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of biochar products with filtering
 */
export function useBiocharProducts(filters?: Partial<BiocharProductFilterData>) {
  return useQuery({
    queryKey: biocharProductKeys.list(filters),
    queryFn: async () => {
      const result = await getBiocharProductsFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single biochar product by ID
 */
export function useBiocharProduct(productId: string, enabled = true) {
  return useQuery({
    queryKey: biocharProductKeys.detail(productId),
    queryFn: async () => {
      const result = await getBiocharProductByIdFn(productId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!productId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch biochar product options for dropdowns
 */
export function useBiocharProductOptions() {
  return useQuery({
    queryKey: biocharProductKeys.options(),
    queryFn: async () => {
      const result = await getBiocharProductOptionsFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to check if a biochar product code is available
 */
export function useBiocharProductCodeCheck(
  code: string,
  excludeProductId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: biocharProductKeys.codeCheck(code, excludeProductId),
    queryFn: async () => {
      const result = await checkBiocharProductCodeFn(code, excludeProductId);
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
// Biochar Product Mutation Hooks
// ============================================

/**
 * Hook to create a new biochar product
 * Supports optional callbacks for custom behavior
 */
export function useCreateBiocharProduct(
  callbacks?: MutationCallbacks<BiocharProduct, CreateBiocharProductData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateBiocharProductData) => {
      const result = await createBiocharProductFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all biochar product lists
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.lists() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.options() });

      // Pre-populate the detail cache with the new product
      queryClient.setQueryData(biocharProductKeys.detail(data.id), data);

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
 * Hook to update an existing biochar product
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateBiocharProduct(
  callbacks?: MutationCallbacks<BiocharProduct, UpdateBiocharProductData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateBiocharProductData) => {
      const result = await updateBiocharProductFn(data);
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
        queryKey: biocharProductKeys.detail(variables.productId),
      });
      await queryClient.cancelQueries({
        queryKey: biocharProductKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousProduct = queryClient.getQueryData<BiocharProductWithRelations>(
        biocharProductKeys.detail(variables.productId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedBiocharProducts>({
        queryKey: biocharProductKeys.lists(),
      });

      // Optimistically update the product detail cache
      if (previousProduct) {
        queryClient.setQueryData<BiocharProductWithRelations>(
          biocharProductKeys.detail(variables.productId),
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

      // Optimistically update product in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedBiocharProducts>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.productId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as BiocharProductWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousProduct, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(biocharProductKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.lists() });
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.options() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousProduct, previousLists } = context as {
          previousProduct?: BiocharProductWithRelations;
          previousLists?: [readonly unknown[], PaginatedBiocharProducts | undefined][];
        };

        if (previousProduct) {
          queryClient.setQueryData(
            biocharProductKeys.detail(variables.productId),
            previousProduct
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
        queryKey: biocharProductKeys.detail(variables.productId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a biochar product
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteBiocharProduct(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (productId: string) => {
      const result = await deleteBiocharProductFn({ productId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (productId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(productId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: biocharProductKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousProduct = queryClient.getQueryData<BiocharProductWithRelations>(
        biocharProductKeys.detail(productId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedBiocharProducts>({
        queryKey: biocharProductKeys.lists(),
      });

      // Optimistically remove product from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedBiocharProducts>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== productId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(productId);

      // Return context with snapshots for rollback
      return { previousProduct, previousLists };
    },
    onSuccess: async (_, productId) => {
      // Remove specific product from cache
      queryClient.removeQueries({ queryKey: biocharProductKeys.detail(productId) });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.lists() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.options() });

      await callbacks?.onSuccess?.(undefined, productId);
    },
    onError: async (error, productId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousProduct, previousLists } = context as {
          previousProduct?: BiocharProductWithRelations;
          previousLists?: [readonly unknown[], PaginatedBiocharProducts | undefined][];
        };

        if (previousProduct) {
          queryClient.setQueryData(
            biocharProductKeys.detail(productId),
            previousProduct
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, productId);
    },
    onSettled: async (data, error, productId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.lists() });

      await callbacks?.onSettled?.(data, error, productId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch biochar products list for faster initial load
 */
export function usePrefetchBiocharProducts() {
  const queryClient = useQueryClient();

  return (filters?: Partial<BiocharProductFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: biocharProductKeys.list(filters),
      queryFn: async () => {
        const result = await getBiocharProductsFn(filters);
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
 * Prefetch a single biochar product
 */
export function usePrefetchBiocharProduct() {
  const queryClient = useQueryClient();

  return (productId: string) => {
    queryClient.prefetchQuery({
      queryKey: biocharProductKeys.detail(productId),
      queryFn: async () => {
        const result = await getBiocharProductByIdFn(productId);
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
 * Hook to access biochar product cache invalidation functions
 * Useful for manual cache control from components
 */
export function useBiocharProductCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all biochar product data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.all }),

    /** Invalidate all biochar product lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.lists() }),

    /** Invalidate a specific biochar product detail */
    invalidateDetail: (productId: string) =>
      queryClient.invalidateQueries({
        queryKey: biocharProductKeys.detail(productId),
      }),

    /** Invalidate biochar product options */
    invalidateOptions: () =>
      queryClient.invalidateQueries({ queryKey: biocharProductKeys.options() }),

    /** Remove a specific biochar product from cache (use after deletion) */
    removeFromCache: (productId: string) => {
      queryClient.removeQueries({ queryKey: biocharProductKeys.detail(productId) });
    },

    /** Set biochar product data in cache (useful for optimistic updates) */
    setBiocharProductData: (productId: string, data: BiocharProductWithRelations) =>
      queryClient.setQueryData(biocharProductKeys.detail(productId), data),

    /** Get cached biochar product data */
    getCachedBiocharProduct: (productId: string) =>
      queryClient.getQueryData<BiocharProductWithRelations>(biocharProductKeys.detail(productId)),
  };
}
