/**
 * Facilities React Query Hooks
 * Client-side state management for facility operations
 * Includes query keys, mutations, optimistic updates, and cache invalidation
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Facility } from "@/db/schema";
import type { FacilityFilterData, CreateFacilityData, UpdateFacilityData } from "@/schemas/facilities";
import type { PaginatedFacilities, FacilityWithRelations } from "@/data-access/facilities";
import {
  getFacilitiesFn,
  getFacilityByIdFn,
  getFacilityCountriesFn,
  getFacilityArchiveImpactFn,
  createFacilityFn,
  updateFacilityFn,
  archiveFacilityFn,
  restoreFacilityFn,
} from "@/fn/facilities";
import { missingRecordMessage } from "@/lib/errors";

import type { MutationCallbacks, OptimisticUpdateOptions } from "./types";
import { invalidateOnboardingProgress } from "./use-onboarding";

// ============================================
// Query Keys
// ============================================

export const facilityKeys = {
  all: ["facilities"] as const,
  lists: () => [...facilityKeys.all, "list"] as const,
  list: (filters?: Partial<FacilityFilterData>) =>
    [...facilityKeys.lists(), filters] as const,
  details: () => [...facilityKeys.all, "detail"] as const,
  detail: (id: string) => [...facilityKeys.details(), id] as const,
  detailWithRelations: (id: string) =>
    [...facilityKeys.details(), id, "relations"] as const,
  reactors: (id: string) => [...facilityKeys.all, id, "reactors"] as const,
  storageLocations: (id: string) =>
    [...facilityKeys.all, id, "storageLocations"] as const,
  countriesPrefix: () => [...facilityKeys.all, "countries"] as const,
  countries: (archived: boolean) =>
    [...facilityKeys.all, "countries", archived] as const,
  codeCheck: (code: string, excludeId?: string) =>
    [...facilityKeys.all, "codeCheck", code, excludeId] as const,
  archiveImpact: (id: string) =>
    [...facilityKeys.all, "archiveImpact", id] as const,
};

// Exact message thrown by the facility data-access reads
// (src/data-access/facilities.ts) for a missing or foreign facility.
// Deterministic — retrying it only prolongs a stale selection window.
const FACILITY_NOT_FOUND_MESSAGE = missingRecordMessage("Facility");
const FACILITY_LOOKUP_MAX_RETRIES = 2;

// ============================================
// Query Hooks
// ============================================

/**
 * Hook to fetch paginated list of facilities with filtering
 */
export function useFacilities(
  filters?: Partial<FacilityFilterData>,
  organizationId?: string | null,
) {
  return useQuery({
    queryKey:
      organizationId === undefined
        ? facilityKeys.list(filters)
        : [...facilityKeys.list(filters), { organizationId }],
    queryFn: async () => {
      const result = await getFacilitiesFn(filters);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: organizationId !== null,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single facility by ID
 */
export function useFacility(
  facilityId: string,
  enabled = true,
  organizationId?: string | null,
) {
  return useQuery({
    queryKey:
      organizationId === undefined
        ? facilityKeys.detail(facilityId)
        : [...facilityKeys.detail(facilityId), { organizationId }],
    queryFn: async () => {
      const result = await getFacilityByIdFn(facilityId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!facilityId && organizationId !== null,
    // Cross-org/missing facility is deterministic — never retry it. Transient
    // failures still retry so a valid deep-linked selection isn't discarded
    // on a network blip.
    retry: (failureCount, error) =>
      !(error instanceof Error && error.message === FACILITY_NOT_FOUND_MESSAGE) &&
      failureCount < FACILITY_LOOKUP_MAX_RETRIES,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch unique facility countries for the filter dropdown — scoped to
 * the active or archived collection so the options always match the list.
 */
export function useFacilityCountries(archived = false) {
  return useQuery({
    queryKey: facilityKeys.countries(archived),
    queryFn: async () => {
      const result = await getFacilityCountriesFn(archived);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 60000, // 1 minute - countries don't change often
  });
}

// ============================================
// Mutation Hooks
// ============================================

/**
 * Hook to create a new facility
 * Supports optional callbacks for custom behavior
 */
export function useCreateFacility(
  callbacks?: MutationCallbacks<Facility, CreateFacilityData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFacilityData) => {
      const result = await createFacilityFn(data);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (variables) => {
      await callbacks?.onMutate?.(variables);
    },
    onSuccess: async (data, variables) => {
      // Invalidate all facility lists
      await queryClient.invalidateQueries({ queryKey: facilityKeys.lists() });
      // Invalidate countries in case a new country was added
      await queryClient.invalidateQueries({ queryKey: facilityKeys.countriesPrefix() });
      await invalidateOnboardingProgress(queryClient);

      // Pre-populate the detail cache with the new facility
      queryClient.setQueryData(facilityKeys.detail(data.id), data);

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
 * Hook to update an existing facility
 * Supports optimistic updates for immediate UI feedback
 *
 * @param callbacks - Optional callbacks for mutation lifecycle events
 * @param options - Options including optimistic update toggle (default: true)
 */
export function useUpdateFacility(
  callbacks?: MutationCallbacks<Facility, UpdateFacilityData>,
  options?: OptimisticUpdateOptions
) {
  const queryClient = useQueryClient();
  const { optimistic = true } = options ?? {};

  return useMutation({
    mutationFn: async (data: UpdateFacilityData) => {
      const result = await updateFacilityFn(data);
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
        queryKey: facilityKeys.detail(variables.facilityId),
      });
      await queryClient.cancelQueries({
        queryKey: facilityKeys.lists(),
      });

      // Snapshot previous values for rollback
      const previousFacility = queryClient.getQueryData<Facility>(
        facilityKeys.detail(variables.facilityId)
      );
      const previousLists = queryClient.getQueriesData<PaginatedFacilities>({
        queryKey: facilityKeys.lists(),
      });

      // Optimistically update the facility detail cache
      if (previousFacility) {
        queryClient.setQueryData<Facility>(
          facilityKeys.detail(variables.facilityId),
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

      // Optimistically update facility in all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<PaginatedFacilities>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.facilityId
                ? ({ ...item, ...variables, updatedAt: new Date() } as FacilityWithRelations)
                : item
            ),
          };
        });
      });

      await callbacks?.onMutate?.(variables);

      // Return context with snapshots for rollback
      return { previousFacility, previousLists };
    },
    onSuccess: async (data, variables) => {
      // Update cache with actual server data
      queryClient.setQueryData(facilityKeys.detail(data.id), data);

      // Invalidate to ensure consistency
      queryClient.invalidateQueries({
        queryKey: facilityKeys.detailWithRelations(data.id),
      });
      queryClient.invalidateQueries({ queryKey: facilityKeys.lists() });
      queryClient.invalidateQueries({ queryKey: facilityKeys.countriesPrefix() });

      await callbacks?.onSuccess?.(data, variables);
    },
    onError: async (error, variables, context) => {
      // Rollback to previous values on error
      if (optimistic && context) {
        const { previousFacility, previousLists } = context as {
          previousFacility?: Facility;
          previousLists?: [readonly unknown[], PaginatedFacilities | undefined][];
        };

        if (previousFacility) {
          queryClient.setQueryData(
            facilityKeys.detail(variables.facilityId),
            previousFacility
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
        queryKey: facilityKeys.detail(variables.facilityId),
      });

      await callbacks?.onSettled?.(data, error, variables);
    },
  });
}

/**
 * Hook to load the archive-impact preview for a facility
 * (child counts + registry-submission warning for the confirm dialog)
 */
export function useFacilityArchiveImpact(facilityId: string | null) {
  return useQuery({
    queryKey: facilityKeys.archiveImpact(facilityId ?? ""),
    queryFn: async () => {
      const result = await getFacilityArchiveImpactFn(facilityId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!facilityId,
    staleTime: 0, // always fresh — drives a destructive-action confirm dialog
  });
}

/**
 * Hook to archive a facility (soft delete, cascades to child data).
 * Archiving hides the facility's children from every entity list in the app,
 * so on success the entire query cache is invalidated.
 */
export function useArchiveFacility(
  callbacks?: MutationCallbacks<Facility, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (facilityId: string) => {
      const result = await archiveFacilityFn({ facilityId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (facilityId) => {
      await callbacks?.onMutate?.(facilityId);
    },
    onSuccess: async (data, facilityId) => {
      // The cascade touches nearly every entity type — invalidate everything
      queryClient.invalidateQueries();

      await callbacks?.onSuccess?.(data, facilityId);
    },
    onError: async (error, facilityId) => {
      await callbacks?.onError?.(error, facilityId);
    },
    onSettled: async (data, error, facilityId) => {
      await callbacks?.onSettled?.(data, error, facilityId);
    },
  });
}

/**
 * Hook to restore an archived facility and its archived child data
 */
export function useRestoreFacility(
  callbacks?: MutationCallbacks<Facility, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (facilityId: string) => {
      const result = await restoreFacilityFn({ facilityId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onMutate: async (facilityId) => {
      await callbacks?.onMutate?.(facilityId);
    },
    onSuccess: async (data, facilityId) => {
      // Restored children reappear across every entity type — invalidate everything
      queryClient.invalidateQueries();

      await callbacks?.onSuccess?.(data, facilityId);
    },
    onError: async (error, facilityId) => {
      await callbacks?.onError?.(error, facilityId);
    },
    onSettled: async (data, error, facilityId) => {
      await callbacks?.onSettled?.(data, error, facilityId);
    },
  });
}

// ============================================
// Prefetch Utilities
// ============================================

// ============================================
// Cache Invalidation Utilities
// ============================================
