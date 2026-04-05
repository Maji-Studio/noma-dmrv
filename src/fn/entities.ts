/**
 * Entity Server Functions
 * Server actions for entity selection and management
 */
"use server";

import { getEntities, getEntityById } from "@/data-access/entities";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

interface SearchEntitiesParams {
  entityType: EntityType;
  search?: string;
  filterBy?: Record<string, string>;
  limit?: number;
}

/**
 * Search entities by type with optional filters
 */
export async function searchEntitiesFn(
  params: SearchEntitiesParams
): Promise<ActionResult<EntityOption[]>> {
  return withAction(async (userId) => {
    return getEntities(userId, params);
  }, { fallbackMessage: "Failed to search entities" });
}

/**
 * Get a single entity by ID
 */
export async function getEntityByIdFn(
  entityType: EntityType,
  id: string
): Promise<ActionResult<EntityOption | null>> {
  return withAction(async (userId) => {
    return getEntityById(userId, entityType, id);
  }, { fallbackMessage: "Failed to fetch entity" });
}
