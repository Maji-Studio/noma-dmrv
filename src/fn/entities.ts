/**
 * Entity Server Functions
 * Server actions for entity selection and management
 */
"use server";

import { getEntities, getEntityById } from "@/data-access/entities";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { ActionResult } from "@/types/actions";

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
  try {
    const entities = await getEntities(params);
    return { success: true, data: entities };
  } catch (error) {
    console.error("Error searching entities:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to search entities",
    };
  }
}

/**
 * Get a single entity by ID
 */
export async function getEntityByIdFn(
  entityType: EntityType,
  id: string
): Promise<ActionResult<EntityOption | null>> {
  try {
    const entity = await getEntityById(entityType, id);
    return { success: true, data: entity };
  } catch (error) {
    console.error("Error fetching entity:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch entity",
    };
  }
}
