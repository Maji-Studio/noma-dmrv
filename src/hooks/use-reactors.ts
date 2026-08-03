/**
 * Reactors React Query Hooks
 * Client-side state management for reactor operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Reactor } from "@/db/schema";
import type { ReactorFilterData, CreateReactorData, UpdateReactorData } from "@/schemas/reactors";
import type { PaginatedReactors, ReactorWithRelations } from "@/data-access/reactors";
import {
  getReactorsFn,
  getReactorByIdFn,
  getReactorsByFacilityFn,
  getReactorTypesFn,
  checkReactorCodeFn,
  createReactorFn,
  updateReactorFn,
  deleteReactorFn,
} from "@/fn/reactors";
import { facilityKeys } from "@/hooks/use-facilities";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";
import { invalidateOnboardingProgress } from "./use-onboarding";

// ============================================
// Query Keys
// ============================================

export const reactorKeys = {
  all: ["reactors"] as const,
  lists: () => [...reactorKeys.all, "list"] as const,
  list: (filters?: Partial<ReactorFilterData>) =>
    [...reactorKeys.lists(), filters] as const,
  details: () => [...reactorKeys.all, "detail"] as const,
  detail: (id: string) => [...reactorKeys.details(), id] as const,
  byFacility: (facilityId: string) =>
    [...reactorKeys.all, "byFacility", facilityId] as const,
  types: () => [...reactorKeys.all, "types"] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...reactorKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of reactors with filtering
 */
export function useReactors(
  filters?: Partial<ReactorFilterData>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: reactorKeys.list(filters),
    queryFn: async () => {
      const result = await getReactorsFn(filters);
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
 * Hook to fetch a single reactor by ID
 */
export function useReactor(reactorId: string, enabled = true) {
  return useQuery({
    queryKey: reactorKeys.detail(reactorId),
    queryFn: async () => {
      const result = await getReactorByIdFn(reactorId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!reactorId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch reactors for a specific facility
 */
export function useReactorsByFacility(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: reactorKeys.byFacility(facilityId),
    queryFn: async () => {
      const result = await getReactorsByFacilityFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch unique reactor types from all reactors
 */
export function useReactorTypes() {
  return useQuery({
    queryKey: reactorKeys.types(),
    queryFn: async () => {
      const result = await getReactorTypesFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute - types don't change often
  });
}

/**
 * Hook to check if a reactor code is available
 */
export function useReactorCodeCheck(
  code: string,
  excludeReactorId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: reactorKeys.codeCheck(code, excludeReactorId),
    queryFn: async () => {
      const result = await checkReactorCodeFn(code, excludeReactorId);
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
 * Hook to create a new reactor
 * Supports optional callbacks for custom behavior
 */
export function useCreateReactor(
  callbacks?: MutationCallbacks<Reactor, CreateReactorData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateReactorData) => {
      const result = await createReactorFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all reactor lists
      queryClient.invalidateQueries({ queryKey: reactorKeys.lists() });
      // Invalidate types in case a new type was added
      queryClient.invalidateQueries({ queryKey: reactorKeys.types() });
      // Invalidate facility reactors
      queryClient.invalidateQueries({
        queryKey: reactorKeys.byFacility(data.facilityId),
      });
      // Invalidate facility detail (reactor count may have changed)
      queryClient.invalidateQueries({
        queryKey: facilityKeys.detail(data.facilityId),
      });
      queryClient.invalidateQueries({
        queryKey: facilityKeys.lists(),
      });
      await invalidateOnboardingProgress(queryClient);

      // Pre-populate the detail cache with the new reactor
      queryClient.setQueryData(reactorKeys.detail(data.id), data);

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
 * Hook to update an existing reactor
 * Supports optimistic updates for immediate UI feedback
 *
 * @param callbacks - Optional callbacks for mutation lifecycle events
 * @param options - Options including optimistic update toggle (default: true)
 */
export function useUpdateReactor(
  callbacks?: MutationCallbacks<Reactor, UpdateReactorData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateReactorData) => {
      const result = await updateReactorFn(data);
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
        queryKey: reactorKeys.detail(variables.reactorId),
      });
      await queryClient.cancelQueries({
        queryKey: reactorKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousReactor = queryClient.getQueryData<ReactorWithRelations>(
        reactorKeys.detail(variables.reactorId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedReactors>({
        queryKey: reactorKeys.lists(),
      });

      // Optimistically update the reactor detail cache
      if (previousReactor) {
        queryClient.setQueryData<ReactorWithRelations>(
          reactorKeys.detail(variables.reactorId),
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

      // Optimistically update reactor in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedReactors>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.reactorId
                ? ({ ...item, ...variables, updatedAt: new Date() } as ReactorWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousReactor, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(reactorKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: reactorKeys.lists() });
      queryClient.invalidateQueries({ queryKey: reactorKeys.types() });
      // Invalidate facility reactors (in case facility changed)
      queryClient.invalidateQueries({
        queryKey: reactorKeys.byFacility(data.facilityId),
      });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousReactor, previousLists } = context as {
          previousReactor?: ReactorWithRelations;
          previousLists?: [readonly unknown[], PaginatedReactors | undefined][];
        };

        if (previousReactor) {
          queryClient.setQueryData(
            reactorKeys.detail(variables.reactorId),
            previousReactor
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
        queryKey: reactorKeys.detail(variables.reactorId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a reactor
 * Supports optimistic updates for immediate UI feedback
 *
 * @param callbacks - Optional callbacks for mutation lifecycle events
 * @param options - Options including optimistic update toggle (default: true)
 */
export function useDeleteReactor(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (reactorId: string) => {
      const result = await deleteReactorFn({ reactorId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (reactorId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(reactorId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: reactorKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousReactor = queryClient.getQueryData<ReactorWithRelations>(
        reactorKeys.detail(reactorId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedReactors>({
        queryKey: reactorKeys.lists(),
      });

      // Optimistically remove reactor from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedReactors>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== reactorId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      // Capture facilityId before optimistic removal clears the cache
      const facilityId = previousReactor?.facilityId;

      await callbacks?.onMutate?.(reactorId);

      // Return context with snapshots for rollback
      return { previousReactor, previousLists, facilityId };
    },
    onSuccess: async (_, reactorId, context) => {
      const facilityId = (context as { facilityId?: string })?.facilityId;

      // Remove specific reactor from cache
      queryClient.removeQueries({ queryKey: reactorKeys.detail(reactorId) });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: reactorKeys.lists() });
      // Invalidate facility reactors
      if (facilityId) {
        queryClient.invalidateQueries({
          queryKey: reactorKeys.byFacility(facilityId),
        });
        // Invalidate facility detail (reactor count may have changed)
        queryClient.invalidateQueries({
          queryKey: facilityKeys.detail(facilityId),
        });
        queryClient.invalidateQueries({
          queryKey: facilityKeys.lists(),
        });
      }

      await callbacks?.onSuccess?.(undefined, reactorId);
    },
    onError: async (error, reactorId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousReactor, previousLists } = context as {
          previousReactor?: ReactorWithRelations;
          previousLists?: [readonly unknown[], PaginatedReactors | undefined][];
        };

        if (previousReactor) {
          queryClient.setQueryData(
            reactorKeys.detail(reactorId),
            previousReactor
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, reactorId);
    },
    onSettled: async (data, error, reactorId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: reactorKeys.lists() });

      await callbacks?.onSettled?.(data, error, reactorId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch reactors list for faster initial load
 */
export function usePrefetchReactors() {
  const queryClient = useQueryClient();

  return (filters?: Partial<ReactorFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: reactorKeys.list(filters),
      queryFn: async () => {
        const result = await getReactorsFn(filters);
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
 * Prefetch a single reactor
 */
export function usePrefetchReactor() {
  const queryClient = useQueryClient();

  return (reactorId: string) => {
    queryClient.prefetchQuery({
      queryKey: reactorKeys.detail(reactorId),
      queryFn: async () => {
        const result = await getReactorByIdFn(reactorId);
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
 * Hook to access reactor cache invalidation functions
 * Useful for manual cache control from components
 */
export function useReactorCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all reactor data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: reactorKeys.all }),

    /** Invalidate all reactor lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: reactorKeys.lists() }),

    /** Invalidate a specific reactor detail */
    invalidateDetail: (reactorId: string) =>
      queryClient.invalidateQueries({
        queryKey: reactorKeys.detail(reactorId),
      }),

    /** Invalidate reactors for a specific facility */
    invalidateByFacility: (facilityId: string) =>
      queryClient.invalidateQueries({
        queryKey: reactorKeys.byFacility(facilityId),
      }),

    /** Invalidate reactor types */
    invalidateTypes: () =>
      queryClient.invalidateQueries({ queryKey: reactorKeys.types() }),

    /** Remove a specific reactor from cache (use after deletion) */
    removeFromCache: (reactorId: string) => {
      queryClient.removeQueries({ queryKey: reactorKeys.detail(reactorId) });
    },

    /** Set reactor data in cache (useful for optimistic updates) */
    setReactorData: (reactorId: string, data: ReactorWithRelations) =>
      queryClient.setQueryData(reactorKeys.detail(reactorId), data),

    /** Get cached reactor data */
    getCachedReactor: (reactorId: string) =>
      queryClient.getQueryData<ReactorWithRelations>(reactorKeys.detail(reactorId)),
  };
}
