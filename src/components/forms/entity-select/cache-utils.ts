/**
 * Entity Select Cache Utilities
 * Shared helpers for managing entity query cache after quick-add operations
 */

import type { QueryClient } from "@tanstack/react-query";
import type { EntityOption, EntityType } from "./types";

/**
 * Seed the single-entity cache entry and invalidate the entity list
 * so the new entity appears in EntitySelect dropdowns.
 */
export function seedEntityCache(
  queryClient: QueryClient,
  entityType: EntityType,
  entity: EntityOption,
) {
  queryClient.setQueryData(["entity", entityType, entity.id], entity);
  void queryClient.invalidateQueries({ queryKey: ["entities", entityType] });
}
