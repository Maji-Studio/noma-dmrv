/**
 * Formulations React Query Hooks
 * Client-side state management for formulation operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Formulation } from "@/db/schema";
import type {
  FormulationFilterData,
  CreateFormulationData,
  UpdateFormulationData,
} from "@/schemas/formulations";
import type {
  PaginatedFormulations,
  FormulationWithRelations,
} from "@/data-access/formulations";
import {
  getFormulationsFn,
  getFormulationByIdFn,
  getFormulationOptionsFn,
  checkFormulationCodeFn,
  createFormulationFn,
  updateFormulationFn,
  deleteFormulationFn,
} from "@/fn/formulations";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";

// ============================================
// Query Keys
// ============================================

export const formulationKeys = {
  all: ["formulations"] as const,
  lists: () => [...formulationKeys.all, "list"] as const,
  list: (filters?: Partial<FormulationFilterData>) =>
    [...formulationKeys.lists(), filters] as const,
  details: () => [...formulationKeys.all, "detail"] as const,
  detail: (id: string) => [...formulationKeys.details(), id] as const,
  options: () => [...formulationKeys.all, "options"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...formulationKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Formulation Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of formulations with filtering
 */
export function useFormulations(filters?: Partial<FormulationFilterData>) {
  return useQuery({
    queryKey: formulationKeys.list(filters),
    queryFn: async () => {
      const result = await getFormulationsFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single formulation by ID
 */
export function useFormulation(formulationId: string, enabled = true) {
  return useQuery({
    queryKey: formulationKeys.detail(formulationId),
    queryFn: async () => {
      const result = await getFormulationByIdFn(formulationId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!formulationId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch formulation options for dropdowns
 */
export function useFormulationOptions() {
  return useQuery({
    queryKey: formulationKeys.options(),
    queryFn: async () => {
      const result = await getFormulationOptionsFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to check if a formulation code is available
 */
export function useFormulationCodeCheck(
  code: string,
  excludeFormulationId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: formulationKeys.codeCheck(code, excludeFormulationId),
    queryFn: async () => {
      const result = await checkFormulationCodeFn(code, excludeFormulationId);
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
// Formulation Mutation Hooks
// ============================================

/**
 * Hook to create a new formulation
 * Supports optional callbacks for custom behavior
 */
export function useCreateFormulation(
  callbacks?: MutationCallbacks<Formulation, CreateFormulationData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFormulationData) => {
      const result = await createFormulationFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all formulation lists
      queryClient.invalidateQueries({ queryKey: formulationKeys.lists() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: formulationKeys.options() });

      // Pre-populate the detail cache with the new formulation
      queryClient.setQueryData(formulationKeys.detail(data.id), data);

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
 * Hook to update an existing formulation
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateFormulation(
  callbacks?: MutationCallbacks<Formulation, UpdateFormulationData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateFormulationData) => {
      const result = await updateFormulationFn(data);
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
        queryKey: formulationKeys.detail(variables.formulationId),
      });
      await queryClient.cancelQueries({
        queryKey: formulationKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousFormulation = queryClient.getQueryData<Formulation>(
        formulationKeys.detail(variables.formulationId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedFormulations>({
        queryKey: formulationKeys.lists(),
      });

      // Optimistically update the formulation detail cache
      if (previousFormulation) {
        queryClient.setQueryData<Formulation>(
          formulationKeys.detail(variables.formulationId),
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

      // Optimistically update formulation in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedFormulations>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.formulationId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as FormulationWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousFormulation, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(formulationKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: formulationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: formulationKeys.options() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousFormulation, previousLists } = context as {
          previousFormulation?: Formulation;
          previousLists?: [readonly unknown[], PaginatedFormulations | undefined][];
        };

        if (previousFormulation) {
          queryClient.setQueryData(
            formulationKeys.detail(variables.formulationId),
            previousFormulation
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
        queryKey: formulationKeys.detail(variables.formulationId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a formulation
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteFormulation(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (formulationId: string) => {
      const result = await deleteFormulationFn({ formulationId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (formulationId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(formulationId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: formulationKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousFormulation = queryClient.getQueryData<Formulation>(
        formulationKeys.detail(formulationId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedFormulations>({
        queryKey: formulationKeys.lists(),
      });

      // Optimistically remove formulation from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedFormulations>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== formulationId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(formulationId);

      // Return context with snapshots for rollback
      return { previousFormulation, previousLists };
    },
    onSuccess: async (_, formulationId) => {
      // Remove specific formulation from cache
      queryClient.removeQueries({ queryKey: formulationKeys.detail(formulationId) });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: formulationKeys.lists() });
      // Invalidate options for dropdowns
      queryClient.invalidateQueries({ queryKey: formulationKeys.options() });

      await callbacks?.onSuccess?.(undefined, formulationId);
    },
    onError: async (error, formulationId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousFormulation, previousLists } = context as {
          previousFormulation?: Formulation;
          previousLists?: [readonly unknown[], PaginatedFormulations | undefined][];
        };

        if (previousFormulation) {
          queryClient.setQueryData(
            formulationKeys.detail(formulationId),
            previousFormulation
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, formulationId);
    },
    onSettled: async (data, error, formulationId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: formulationKeys.lists() });

      await callbacks?.onSettled?.(data, error, formulationId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch formulations list for faster initial load
 */
export function usePrefetchFormulations() {
  const queryClient = useQueryClient();

  return (filters?: Partial<FormulationFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: formulationKeys.list(filters),
      queryFn: async () => {
        const result = await getFormulationsFn(filters);
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
 * Prefetch a single formulation
 */
export function usePrefetchFormulation() {
  const queryClient = useQueryClient();

  return (formulationId: string) => {
    queryClient.prefetchQuery({
      queryKey: formulationKeys.detail(formulationId),
      queryFn: async () => {
        const result = await getFormulationByIdFn(formulationId);
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
 * Hook to access formulation cache invalidation functions
 * Useful for manual cache control from components
 */
export function useFormulationCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all formulation data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: formulationKeys.all }),

    /** Invalidate all formulation lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: formulationKeys.lists() }),

    /** Invalidate a specific formulation detail */
    invalidateDetail: (formulationId: string) =>
      queryClient.invalidateQueries({
        queryKey: formulationKeys.detail(formulationId),
      }),

    /** Invalidate formulation options */
    invalidateOptions: () =>
      queryClient.invalidateQueries({ queryKey: formulationKeys.options() }),

    /** Remove a specific formulation from cache (use after deletion) */
    removeFromCache: (formulationId: string) => {
      queryClient.removeQueries({ queryKey: formulationKeys.detail(formulationId) });
    },

    /** Set formulation data in cache (useful for optimistic updates) */
    setFormulationData: (formulationId: string, data: Formulation) =>
      queryClient.setQueryData(formulationKeys.detail(formulationId), data),

    /** Get cached formulation data */
    getCachedFormulation: (formulationId: string) =>
      queryClient.getQueryData<Formulation>(formulationKeys.detail(formulationId)),
  };
}
