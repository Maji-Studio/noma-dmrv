/**
 * Storage Locations React Query Hooks
 * Client-side state management for storage location operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StorageLocation } from "@/db/schema";
import type {
  StorageLocationFilterData,
  CreateStorageLocationData,
  UpdateStorageLocationData,
} from "@/schemas/storage-locations";
import type {
  PaginatedStorageLocations,
  StorageLocationWithFacility,
} from "@/data-access/storage-locations";
import {
  getStorageLocationsFn,
  getStorageLocationByIdFn,
  getStorageLocationWithFacilityFn,
  getStorageLocationsByFacilityFn,
  checkStorageLocationCodeFn,
  createStorageLocationFn,
  updateStorageLocationFn,
  deleteStorageLocationFn,
} from "@/fn/storage-locations";
import { facilityKeys } from "@/hooks/use-facilities";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";

// ============================================
// Query Keys
// ============================================

export const storageLocationKeys = {
  all: ["storageLocations"] as const,
  lists: () => [...storageLocationKeys.all, "list"] as const,
  list: (filters?: Partial<StorageLocationFilterData>) =>
    [...storageLocationKeys.lists(), filters] as const,
  details: () => [...storageLocationKeys.all, "detail"] as const,
  detail: (id: string) => [...storageLocationKeys.details(), id] as const,
  detailWithFacility: (id: string) =>
    [...storageLocationKeys.details(), id, "facility"] as const,
  byFacility: (facilityId: string) =>
    [...storageLocationKeys.all, "byFacility", facilityId] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...storageLocationKeys.all, "codeCheck", code, excludeId] as const,
};

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of storage locations with filtering
 */
export function useStorageLocations(
  filters?: Partial<StorageLocationFilterData>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: storageLocationKeys.list(filters),
    queryFn: async () => {
      const result = await getStorageLocationsFn(filters);
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
 * Hook to fetch a single storage location by ID
 */
export function useStorageLocation(storageLocationId: string, enabled = true) {
  return useQuery({
    queryKey: storageLocationKeys.detail(storageLocationId),
    queryFn: async () => {
      const result = await getStorageLocationByIdFn(storageLocationId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!storageLocationId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch a storage location with its facility info
 */
export function useStorageLocationWithFacility(
  storageLocationId: string,
  enabled = true
) {
  return useQuery({
    queryKey: storageLocationKeys.detailWithFacility(storageLocationId),
    queryFn: async () => {
      const result =
        await getStorageLocationWithFacilityFn(storageLocationId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!storageLocationId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch storage locations for a specific facility
 */
export function useStorageLocationsByFacility(
  facilityId: string,
  enabled = true
) {
  return useQuery({
    queryKey: storageLocationKeys.byFacility(facilityId),
    queryFn: async () => {
      const result = await getStorageLocationsByFacilityFn(facilityId);
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
 * Hook to check if a storage location code is available
 */
export function useStorageLocationCodeCheck(
  code: string,
  excludeStorageLocationId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: storageLocationKeys.codeCheck(code, excludeStorageLocationId),
    queryFn: async () => {
      const result = await checkStorageLocationCodeFn(
        code,
        excludeStorageLocationId
      );
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
 * Hook to create a new storage location
 * Supports optional callbacks for custom behavior
 */
export function useCreateStorageLocation(
  callbacks?: MutationCallbacks<StorageLocation, CreateStorageLocationData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateStorageLocationData) => {
      const result = await createStorageLocationFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all storage location lists
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: storageLocationKeys.lists(),
        }),
        // Invalidate storage locations by facility
        queryClient.invalidateQueries({
          queryKey: storageLocationKeys.byFacility(variables.facilityId),
        }),
        // Invalidate facility storage locations in facility cache
        queryClient.invalidateQueries({
          queryKey: facilityKeys.storageLocations(variables.facilityId),
        }),
      ]);

      // Pre-populate the detail cache with the new storage location
      queryClient.setQueryData(storageLocationKeys.detail(data.id), data);

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
 * Hook to update an existing storage location
 * Supports optimistic updates for immediate UI feedback
 */
export function useUpdateStorageLocation(
  callbacks?: MutationCallbacks<StorageLocation, UpdateStorageLocationData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateStorageLocationData) => {
      const result = await updateStorageLocationFn(data);
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
        queryKey: storageLocationKeys.detail(variables.storageLocationId),
      });
      await queryClient.cancelQueries({
        queryKey: storageLocationKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousStorageLocation =
        queryClient.getQueryData<StorageLocation>(
          storageLocationKeys.detail(variables.storageLocationId)
        );
      const previousLists =
        queryClient.getQueriesData<PaginatedStorageLocations>({
          queryKey: storageLocationKeys.lists(),
        });

      // Optimistically update the storage location detail cache
      if (previousStorageLocation) {
        queryClient.setQueryData<StorageLocation>(
          storageLocationKeys.detail(variables.storageLocationId),
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

      // Optimistically update storage location in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedStorageLocations>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.storageLocationId
                ? ({
                    ...item,
                    ...variables,
                    updatedAt: new Date(),
                  } as StorageLocationWithFacility)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousStorageLocation, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(storageLocationKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: storageLocationKeys.detailWithFacility(data.id),
        }),
        queryClient.invalidateQueries({
          queryKey: storageLocationKeys.lists(),
        }),
        // Invalidate byFacility queries for both old and potentially new facility
        queryClient.invalidateQueries({
          queryKey: storageLocationKeys.byFacility(data.facilityId),
        }),
        queryClient.invalidateQueries({
          queryKey: facilityKeys.storageLocations(data.facilityId),
        }),
      ]);

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousStorageLocation, previousLists } = context as {
          previousStorageLocation?: StorageLocation;
          previousLists?: [
            readonly unknown[],
            PaginatedStorageLocations | undefined,
          ][];
        };

        if (previousStorageLocation) {
          queryClient.setQueryData(
            storageLocationKeys.detail(variables.storageLocationId),
            previousStorageLocation
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
        queryKey: storageLocationKeys.detail(variables.storageLocationId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to delete a storage location
 * Supports optimistic updates for immediate UI feedback
 */
export function useDeleteStorageLocation(
  callbacks?: MutationCallbacks<void, string>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (storageLocationId: string) => {
      const result = await deleteStorageLocationFn({ storageLocationId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return;
    },
    onMutate: async (storageLocationId) => {
      if (!optimistic) {
        await callbacks?.onMutate?.(storageLocationId);
        return;
      }

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: storageLocationKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousStorageLocation =
        queryClient.getQueryData<StorageLocation>(
          storageLocationKeys.detail(storageLocationId)
        );
      const previousLists =
        queryClient.getQueriesData<PaginatedStorageLocations>({
          queryKey: storageLocationKeys.lists(),
        });

      // Optimistically remove storage location from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedStorageLocations>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== storageLocationId),
            total: Math.max(0, old.total - 1),
          };
        });
      });

      await callbacks?.onMutate?.(storageLocationId);

      // Return context with snapshots for rollback
      return { previousStorageLocation, previousLists };
    },
    onSuccess: async (_, storageLocationId) => {
      // Get the storage location to know its facility
      const storageLocation = queryClient.getQueryData<StorageLocation>(
        storageLocationKeys.detail(storageLocationId)
      );

      // Remove specific storage location from cache
      queryClient.removeQueries({
        queryKey: storageLocationKeys.detail(storageLocationId),
      });
      queryClient.removeQueries({
        queryKey: storageLocationKeys.detailWithFacility(storageLocationId),
      });

      // Invalidate lists for consistency
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: storageLocationKeys.lists(),
        }),
        // Invalidate facility-specific caches
        ...(storageLocation?.facilityId
          ? [
              queryClient.invalidateQueries({
                queryKey: storageLocationKeys.byFacility(storageLocation.facilityId),
              }),
              queryClient.invalidateQueries({
                queryKey: facilityKeys.storageLocations(storageLocation.facilityId),
              }),
            ]
          : []),
      ]);

      await callbacks?.onSuccess?.(undefined, storageLocationId);
    },
    onError: async (error, storageLocationId, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousStorageLocation, previousLists } = context as {
          previousStorageLocation?: StorageLocation;
          previousLists?: [
            readonly unknown[],
            PaginatedStorageLocations | undefined,
          ][];
        };

        if (previousStorageLocation) {
          queryClient.setQueryData(
            storageLocationKeys.detail(storageLocationId),
            previousStorageLocation
          );
        }

        previousLists?.forEach(([queryKey, data]) => {
          if (data) {
            queryClient.setQueryData(queryKey, data);
          }
        });
      }

      await callbacks?.onError?.(error, storageLocationId);
    },
    onSettled: async (data, error, storageLocationId) => {
      // Refetch lists to ensure consistency
      queryClient.invalidateQueries({
        queryKey: storageLocationKeys.lists(),
      });

      await callbacks?.onSettled?.(data, error, storageLocationId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

/**
 * Prefetch storage locations list for faster initial load
 */
export function usePrefetchStorageLocations() {
  const queryClient = useQueryClient();

  return (filters?: Partial<StorageLocationFilterData>) => {
    queryClient.prefetchQuery({
      queryKey: storageLocationKeys.list(filters),
      queryFn: async () => {
        const result = await getStorageLocationsFn(filters);
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
 * Prefetch a single storage location
 */
export function usePrefetchStorageLocation() {
  const queryClient = useQueryClient();

  return (storageLocationId: string) => {
    queryClient.prefetchQuery({
      queryKey: storageLocationKeys.detail(storageLocationId),
      queryFn: async () => {
        const result = await getStorageLocationByIdFn(storageLocationId);
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
 * Hook to access storage location cache invalidation functions
 * Useful for manual cache control from components
 */
export function useStorageLocationCacheInvalidation() {
  const queryClient = useQueryClient();

  return {
    /** Invalidate all storage location data */
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: storageLocationKeys.all }),

    /** Invalidate all storage location lists */
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: storageLocationKeys.lists() }),

    /** Invalidate a specific storage location detail */
    invalidateDetail: (storageLocationId: string) =>
      queryClient.invalidateQueries({
        queryKey: storageLocationKeys.detail(storageLocationId),
      }),

    /** Invalidate a storage location with its facility */
    invalidateDetailWithFacility: (storageLocationId: string) =>
      queryClient.invalidateQueries({
        queryKey: storageLocationKeys.detailWithFacility(storageLocationId),
      }),

    /** Invalidate storage locations by facility */
    invalidateByFacility: (facilityId: string) =>
      queryClient.invalidateQueries({
        queryKey: storageLocationKeys.byFacility(facilityId),
      }),

    /** Remove a specific storage location from cache (use after deletion) */
    removeFromCache: (storageLocationId: string) => {
      queryClient.removeQueries({
        queryKey: storageLocationKeys.detail(storageLocationId),
      });
      queryClient.removeQueries({
        queryKey: storageLocationKeys.detailWithFacility(storageLocationId),
      });
    },

    /** Set storage location data in cache (useful for optimistic updates) */
    setStorageLocationData: (
      storageLocationId: string,
      data: StorageLocation
    ) =>
      queryClient.setQueryData(
        storageLocationKeys.detail(storageLocationId),
        data
      ),

    /** Get cached storage location data */
    getCachedStorageLocation: (storageLocationId: string) =>
      queryClient.getQueryData<StorageLocation>(
        storageLocationKeys.detail(storageLocationId)
      ),
  };
}
