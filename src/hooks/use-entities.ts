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
import { unwrap } from "@/hooks/types";

/**
 * Hook to search and load entity options
 * Supports debounced search and filtering
 */
export function useEntityOptions(params: UseEntityOptionsParams) {
  const { entityType, search, filterBy, enabled = true } = params;

  return useQuery({
    queryKey: entityKeys.list(entityType, search, filterBy),
    queryFn: async () =>
      unwrap(
        await searchEntitiesFn({
          entityType,
          search,
          filterBy,
        }),
      ),
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
  id: string | undefined,
  // Per-caller derivation params (e.g. biocharProduct's excludeOrderId);
  // part of the query key so two callers with different exclusions never
  // share a cached figure.
  filterBy?: Record<string, string>,
) {
  return useQuery({
    queryKey: entityKeys.detail(entityType, id, filterBy),
    queryFn: async () => {
      if (!id) return null;
      return unwrap(await getEntityByIdFn(entityType, id, filterBy));
    },
    staleTime: ENTITY_DETAIL_STALE_TIME_MS,
    enabled: !!id,
  });
}
