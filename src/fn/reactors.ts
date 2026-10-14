"use server";

import { withAction } from "./with-action";

/**
 * Reactors Server Actions
 * Server-side functions for reactor CRUD operations
 */

import { z } from "zod";
import { type Reactor, reactors } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import { requireOrgFacility } from "@/data-access/utils";
import {
  createReactor,
  deleteReactor,
  getReactors as getReactorsData,
  updateReactor,
  type PaginatedReactors,
} from "@/data-access/reactors";
import {
  createReactorSchema,
  deleteReactorSchema,
  updateReactorSchema,
  reactorFilterSchema,
} from "@/schemas/reactors";
import type { ActionResult } from "@/types/actions";
import { getReactorById } from "@/data-access/reactors";
import { uuidSchema } from "@/schemas/helpers";

const LOG_MESSAGE = "reactor action failed";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of reactors with filtering
 */
export async function getReactorsFn(
  filters?: Partial<z.infer<typeof reactorFilterSchema>>
): Promise<ActionResult<PaginatedReactors>> {
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? reactorFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const reactors = await getReactorsData(ctx, validatedFilters);

    return reactors;
  }, {
    fallbackMessage: "Failed to load reactors",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: LOG_MESSAGE, context: { op: "reactor:list" } },
  });
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new reactor
 */
export async function createReactorFn(
  data: z.infer<typeof createReactorSchema>
): Promise<ActionResult<Reactor>> {
  return withAction(async (ctx) => {
    const validated = createReactorSchema.parse(data);

    const reactor = await withAutoCode(
      ctx,
      "R",
      reactors,
      reactors.code,
      undefined,
      (code) =>
        createReactor(ctx, {
          code,
          identifier: validated.identifier,
          facilityId: validated.facilityId,
          reactorType: validated.reactorType,
          nominalThroughputTph: validated.nominalThroughputTph ?? null,
          specifications: validated.specifications ?? null,
        }),
      CODE_CONFLICT_MESSAGES.reactor,
    );

    return reactor;
  }, {
    fallbackMessage: "Failed to create reactor",
    log: { message: LOG_MESSAGE, context: { op: "reactor:create" } },
  });
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing reactor
 */
export async function updateReactorFn(
  data: z.infer<typeof updateReactorSchema>
): Promise<ActionResult<Reactor>> {
  return withAction(async (ctx) => {

    const validated = updateReactorSchema.parse(data);

    const reactor = await updateReactor(ctx, validated.reactorId, {
      expectedVersion: validated.expectedVersion,
      code: validated.code,
      identifier: validated.identifier,
      facilityId: validated.facilityId,
      reactorType: validated.reactorType,
      nominalThroughputTph: validated.nominalThroughputTph,
      specifications: validated.specifications,
    });

    return reactor;
  }, { fallbackMessage: "Failed to update reactor", log: { message: LOG_MESSAGE, context: { op: "reactor:update" } } });
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a reactor
 */
export async function deleteReactorFn(
  data: z.infer<typeof deleteReactorSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteReactorSchema.parse(data);
    await deleteReactor(ctx, validated.reactorId, validated.expectedVersion);

    return undefined;
  }, { fallbackMessage: "Failed to delete reactor", log: { message: LOG_MESSAGE, context: { op: "reactor:delete" } } });
}

export async function getReactorByIdFn(id: string) {
  return withAction((ctx) => getReactorById(ctx, uuidSchema().parse(id)));
}
