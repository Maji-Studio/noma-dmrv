/**
 * Entity Hooks
 * React Query hooks for entity selection with async loading
 */

import { useQuery } from "@tanstack/react-query";
import { searchEntitiesFn, getEntityByIdFn } from "@/fn/entities";
import type {
  EntityType,
  UseEntityOptionsParams,
} from "@/components/forms/entity-select/types";
import {
  ENTITY_DETAIL_STALE_TIME_MS,
  ENTITY_LIST_STALE_TIME_MS,
  entityKeys,
} from "./entity-query-keys";

/**
 * Hook to search and load entity options
 * Supports debounced search and filtering
 */
export function useEntityOptions(params: UseEntityOptionsParams) {
  const { entityType, search, filterBy, enabled = true } = params;

  return useQuery({
    queryKey: entityKeys.list(entityType, search, filterBy),
    queryFn: async () => {
      const result = await searchEntitiesFn({
        entityType,
        search,
        filterBy,
      });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: ENTITY_LIST_STALE_TIME_MS,
    enabled,
  });
}

/**
 * Hook to get a single entity by ID
 * Used to display the selected entity's name
 */
export function useEntityById(
  entityType: EntityType,
  id: string | undefined
) {
  return useQuery({
    queryKey: entityKeys.detail(entityType, id),
    queryFn: async () => {
      if (!id) return null;
      const result = await getEntityByIdFn(entityType, id);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: ENTITY_DETAIL_STALE_TIME_MS,
    enabled: !!id,
  });
}

/**
 * Convenience hooks for specific entity types
 */

export function useFacilities(search?: string) {
  return useEntityOptions({ entityType: "facility", search });
}

export function useReactorOptions(search?: string, facilityId?: string) {
  return useEntityOptions({
    entityType: "reactor",
    search,
    filterBy: facilityId ? { facilityId } : undefined,
  });
}

export function useSuppliers(search?: string) {
  return useEntityOptions({ entityType: "supplier", search });
}

export function useCustomers(search?: string) {
  return useEntityOptions({ entityType: "customer", search });
}

export function useDrivers(search?: string) {
  return useEntityOptions({ entityType: "driver", search });
}

export function useOperators(search?: string) {
  return useEntityOptions({ entityType: "operator", search });
}

export function useStorageLocations(
  search?: string,
  filterBy?: { facilityId?: string; type?: string }
) {
  return useEntityOptions({
    entityType: "storageLocation",
    search,
    filterBy,
  });
}

export function useVehicles(search?: string) {
  return useEntityOptions({ entityType: "vehicle", search });
}

export function useFeedstockTypes(search?: string) {
  return useEntityOptions({ entityType: "feedstockType", search });
}

export function useFeedstocks(search?: string, facilityId?: string) {
  return useEntityOptions({
    entityType: "feedstock",
    search,
    filterBy: facilityId ? { facilityId } : undefined,
  });
}

export function useProductionRunOptions(search?: string, facilityId?: string) {
  return useEntityOptions({
    entityType: "productionRun",
    search,
    filterBy: facilityId ? { facilityId } : undefined,
  });
}
