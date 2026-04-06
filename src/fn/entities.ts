/**
 * Entity Server Functions
 * Server actions for entity selection and management
 */
"use server";

import { z } from "zod";
import { getEntities, getEntityById } from "@/data-access/entities";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const ENTITY_TYPES = [
  "facility", "reactor", "supplier", "customer", "driver", "operator",
  "storageLocation", "vehicle", "feedstockType", "feedstock",
  "productionRun", "formulation", "creditBatch",
] as const;

const VALID_ENTITY_TYPES = new Set<string>(ENTITY_TYPES);

const MAX_SEARCH_LIMIT = 200;

const entityTypeSchema = z.string().refine(
  (v): v is EntityType => VALID_ENTITY_TYPES.has(v),
  { message: "Invalid entity type" },
);

const searchEntitiesSchema = z.object({
  entityType: entityTypeSchema,
  search: z.string().optional(),
  filterBy: z.record(z.string(), z.string()).optional(),
  limit: z.number().int().positive().max(MAX_SEARCH_LIMIT).optional(),
});

/**
 * Search entities by type with optional filters
 */
export async function searchEntitiesFn(
  params: unknown
): Promise<ActionResult<EntityOption[]>> {
  return withAction(async (userId) => {
    const validated = searchEntitiesSchema.parse(params);
    return getEntities(userId, validated);
  }, { zodErrorPrefix: "Invalid search parameters", fallbackMessage: "Failed to search entities" });
}

/**
 * Get a single entity by ID
 */
export async function getEntityByIdFn(
  entityType: unknown,
  id: unknown
): Promise<ActionResult<EntityOption | null>> {
  return withAction(async (userId) => {
    const validatedType = entityTypeSchema.parse(entityType);
    const validatedId = z.string().uuid().parse(id);
    return getEntityById(userId, validatedType, validatedId);
  }, { zodErrorPrefix: "Invalid entity parameters", fallbackMessage: "Failed to fetch entity" });
}
