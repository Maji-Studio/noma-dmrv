/**
 * Entity Server Functions
 * Server actions for entity selection and management
 */
"use server";

import { z } from "zod";
import { getEntities, getEntityById } from "@/data-access/entities";
import { requireOrgFacility } from "@/data-access/utils";
import type { EntityOption, EntityType } from "@/components/forms/entity-select/types";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const ENTITY_TYPES = [
  "facility", "reactor", "supplier", "customer", "driver", "operator",
  "storageLocation", "vehicle", "feedstockType", "feedstock",
  "productionRun", "application", "formulation", "biocharProduct", "order",
  "creditBatch",
] as const;

const VALID_ENTITY_TYPES = new Set<string>(ENTITY_TYPES);

const MAX_SEARCH_LIMIT = 200;

const entityTypeSchema = z.string().refine(
  (v): v is EntityType => VALID_ENTITY_TYPES.has(v),
  { message: "Invalid entity type" },
);

const searchEntitiesSchema = z
  .object({
    entityType: entityTypeSchema,
    search: z.string().optional(),
    filterBy: z.record(z.string(), z.string()).optional(),
    limit: z.number().int().positive().max(MAX_SEARCH_LIMIT).optional(),
  })
  .superRefine((data, ctx) => {
    // filterBy is a free-form record; facilityId feeds the org-scope guard
    // and uuid-typed query filters, so a blank/malformed value must be a
    // validation error rather than silently degrading to an unfiltered read.
    if (
      data.filterBy?.facilityId !== undefined &&
      !z.uuid().safeParse(data.filterBy.facilityId).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filterBy", "facilityId"],
        message: "The facility filter is invalid. Refresh the page and try again.",
      });
    }
    if (
      data.filterBy?.excludeOrderId !== undefined &&
      !z.uuid().safeParse(data.filterBy.excludeOrderId).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filterBy", "excludeOrderId"],
        message: "The order filter is invalid. Refresh the page and try again.",
      });
    }
  });

/**
 * Search entities by type with optional filters
 */
export async function searchEntitiesFn(
  params: unknown
): Promise<ActionResult<EntityOption[]>> {
  return withAction(async (ctx) => {
    const validated = searchEntitiesSchema.parse(params);
    if (validated.filterBy?.facilityId) {
      await requireOrgFacility(ctx, validated.filterBy.facilityId);
    }
    return getEntities(ctx, validated);
  }, { zodErrorPrefix: "Invalid search parameters", fallbackMessage: "Failed to search entities" });
}

const entityByIdFilterSchema = z
  .object({
    excludeOrderId: z.uuid().optional(),
  })
  .optional();

/**
 * Get a single entity by ID
 */
export async function getEntityByIdFn(
  entityType: unknown,
  id: unknown,
  filterBy?: unknown,
): Promise<ActionResult<EntityOption | null>> {
  return withAction(async (ctx) => {
    const validatedType = entityTypeSchema.parse(entityType);
    const validatedId = z.string().uuid().parse(id);
    const validatedFilterBy = entityByIdFilterSchema.parse(filterBy);
    return getEntityById(ctx, validatedType, validatedId, validatedFilterBy);
  }, { zodErrorPrefix: "Invalid entity parameters", fallbackMessage: "Failed to fetch entity" });
}
