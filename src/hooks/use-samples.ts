/**
 * Samples React Query Hooks
 * Client-side state management for sample operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SampleFilterData,
  CreateSampleData,
  UpdateSampleData,
} from "@/schemas/samples";
import type {
  PaginatedSamples,
  SampleWithRelations,
} from "@/data-access/samples";
import {
  getSamplesFn,
  getSampleByIdFn,
  getSampleStatsFn,
  checkSampleCodeFn,
  generateNextSampleCodeFn,
  createSampleFn,
  updateSampleFn,
  deleteSampleFn,
} from "@/fn/samples";
import { invalidateCertificationReadiness } from "@/hooks/use-certification";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";

// ============================================
// Query Keys
// ============================================

export const sampleKeys = {
  all: ["samples"] as const,
  lists: () => [...sampleKeys.all, "list"] as const,
  list: (filters?: Partial<SampleFilterData>) =>
    [...sampleKeys.lists(), filters] as const,
  details: () => [...sampleKeys.all, "detail"] as const,
  detail: (id: string) => [...sampleKeys.details(), id] as const,
  stats: (creditBatchId?: string, facilityId?: string) =>
    [...sampleKeys.all, "stats", creditBatchId, facilityId] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...sampleKeys.all, "codeCheck", code, excludeId] as const,
  nextCode: () => [...sampleKeys.all, "nextCode"] as const,
};

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of samples with filtering
 */
export function useSamples(
  filters?: Partial<SampleFilterData>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: sampleKeys.list(filters),
    queryFn: async () => {
      const result = await getSamplesFn(filters);
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
 * Hook to fetch a single sample by ID
 */
export function useSample(sampleId: string, enabled = true) {
  return useQuery({
    queryKey: sampleKeys.detail(sampleId),
    queryFn: async () => {
      const result = await getSampleByIdFn(sampleId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!sampleId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch sample statistics
 */
export function useSampleStats(
  creditBatchId?: string,
  enabled = true,
  facilityId?: string,
) {
  return useQuery({
    queryKey: sampleKeys.stats(creditBatchId, facilityId),
    queryFn: async () => {
      const result = await getSampleStatsFn(creditBatchId, facilityId);
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
 * Hook to check if a sample code is available
 */
export function useSampleCodeCheck(
  code: string,
  excludeSampleId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: sampleKeys.codeCheck(code, excludeSampleId),
    queryFn: async () => {
      const result = await checkSampleCodeFn(code, excludeSampleId);
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
 * Hook to generate the next sample code
 */
export function useNextSampleCode(enabled = true) {
  return useQuery({
    queryKey: sampleKeys.nextCode(),
    queryFn: async () => {
      const result = await generateNextSampleCodeFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data.code;
    },
    enabled,
    staleTime: 0, // Always fetch fresh
  });
}

// ============================================
// Mutation Hooks
// ============================================

/**
 * Hook to create a new sample
 * Supports optional callbacks for custom behavior
 */
export function useCreateSample(
  callbacks?: MutationCallbacks<SampleWithRelations, CreateSampleData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSampleData) => {
      const result = await createSampleFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all sample lists
      queryClient.invalidateQueries({ queryKey: sampleKeys.lists() });
      // Invalidate stats
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "samples" && q.queryKey[1] === "stats",
      });
      // Invalidate next code
      queryClient.invalidateQueries({ queryKey: sampleKeys.nextCode() });

      // Refresh the durability readiness surfaces this sample rolls up to.
      invalidateCertificationReadiness(queryClient, {
        creditBatchPreviews: true,
      });

      // Pre-populate the detail cache with the new sample
      queryClient.setQueryData(sampleKeys.detail(data.id), data);

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
 * Hook to update an existing sample
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateSample(
  callbacks?: MutationCallbacks<SampleWithRelations, UpdateSampleData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateSampleData) => {
      const result = await updateSampleFn(data);
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
        queryKey: sampleKeys.detail(variables.sampleId),
      });
      await queryClient.cancelQueries({
        queryKey: sampleKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousSample = queryClient.getQueryData<SampleWithRelations>(
        sampleKeys.detail(variables.sampleId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedSamples>({
        queryKey: sampleKeys.lists(),
      });

      // Optimistically update the sample detail cache
      if (previousSample) {
        queryClient.setQueryData<SampleWithRelations>(
          sampleKeys.detail(variables.sampleId),
          (old) => {
            if (!old) return old;
            // Only update fields that can be safely merged
            return {
              ...old,
              sampleCode: variables.sampleCode ?? old.sampleCode,
              totalCarbonPercent: variables.totalCarbonPercent ?? old.totalCarbonPercent,
              organicCarbonPercent: variables.organicCarbonPercent ?? old.organicCarbonPercent,
              updatedAt: new Date(),
            };
          }
        );
      }

      // Optimistically update sample in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedSamples>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) => {
              if (item.id !== variables.sampleId) return item;
              // Only update fields that can be safely merged
              return {
                ...item,
                sampleCode: variables.sampleCode ?? item.sampleCode,
                totalCarbonPercent: variables.totalCarbonPercent ?? item.totalCarbonPercent,
                organicCarbonPercent: variables.organicCarbonPercent ?? item.organicCarbonPercent,
                updatedAt: new Date(),
              };
            }),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousSample, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(sampleKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: sampleKeys.lists() });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "samples" && q.queryKey[1] === "stats",
      });

      // Chemistry and batch membership feed both readiness and CO₂e previews.
      invalidateCertificationReadiness(queryClient, {
        creditBatchPreviews: true,
      });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousSample, previousLists } = context as {
          previousSample?: SampleWithRelations;
          previousLists?: [readonly unknown[], PaginatedSamples | undefined][];
        };

        if (previousSample) {
          queryClient.setQueryData(
            sampleKeys.detail(variables.sampleId),
            previousSample
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
        queryKey: sampleKeys.detail(variables.sampleId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a sample
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteSample(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (sampleId: string) => {
      const result = await deleteSampleFn({ sampleId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (sampleId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(sampleId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: sampleKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousSample = queryClient.getQueryData<SampleWithRelations>(
        sampleKeys.detail(sampleId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedSamples>({
        queryKey: sampleKeys.lists(),
      });
      // Optimistically remove sample from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedSamples>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== sampleId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(sampleId);

      // Return context with snapshots for rollback
      return { previousSample, previousLists };
    },
    onSuccess: async (_, sampleId) => {
      // Remove specific sample from cache
      queryClient.removeQueries({
        queryKey: sampleKeys.detail(sampleId),
      });
      // Invalidate lists for consistency
      queryClient.invalidateQueries({ queryKey: sampleKeys.lists() });
      // Invalidate stats
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "samples" && q.queryKey[1] === "stats",
      });
      // Deletion changes durability readiness and derived CO₂e previews.
      invalidateCertificationReadiness(queryClient, {
        creditBatchPreviews: true,
      });

      await callbacks?.onSuccess?.(undefined, sampleId);
    },
    onError: async (error, sampleId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousSample, previousLists } = context as {
          previousSample?: SampleWithRelations;
          previousLists?: [readonly unknown[], PaginatedSamples | undefined][];
        };

        if (previousSample) {
          queryClient.setQueryData(
            sampleKeys.detail(sampleId),
            previousSample
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, sampleId);
    },
    onSettled: async (data, error, sampleId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: sampleKeys.lists() });

      await callbacks?.onSettled?.(data, error, sampleId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch samples list for faster initial load
 */
export function usePrefetchSamples() {
  const queryClient = useQueryClient();

  return (filters?: Partial<SampleFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: sampleKeys.list(filters),
      queryFn: async () => {
        const result = await getSamplesFn(filters);
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
 * Prefetch a single sample
 */
export function usePrefetchSample() {
  const queryClient = useQueryClient();

  return (sampleId: string) => {
    queryClient.prefetchQuery({
      queryKey: sampleKeys.detail(sampleId),
      queryFn: async () => {
        const result = await getSampleByIdFn(sampleId);
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
 * Hook to access sample cache invalidation functions
 * Useful for manual cache control from components
 */
export function useSampleCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all sample data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: sampleKeys.all }),

    /** Invalidate all sample lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: sampleKeys.lists() }),

    /** Invalidate a specific sample detail */
    invalidateDetail: (sampleId: string) =>
      queryClient.invalidateQueries({
        queryKey: sampleKeys.detail(sampleId),
      }),

    /** Invalidate sample stats */
    invalidateStats: (creditBatchId?: string, facilityId?: string) =>
      queryClient.invalidateQueries({
        queryKey: sampleKeys.stats(creditBatchId, facilityId),
      }),

    /** Remove a specific sample from cache (use after deletion) */
    removeFromCache: (sampleId: string) => {
      queryClient.removeQueries({
        queryKey: sampleKeys.detail(sampleId),
      });
    },

    /** Set sample data in cache (useful for optimistic updates) */
    setSampleData: (sampleId: string, data: SampleWithRelations) =>
      queryClient.setQueryData(sampleKeys.detail(sampleId), data),

    /** Get cached sample data */
    getCachedSample: (sampleId: string) =>
      queryClient.getQueryData<SampleWithRelations>(
        sampleKeys.detail(sampleId)
      ),
  };
}
