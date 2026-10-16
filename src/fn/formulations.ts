"use server";

import { withAction } from "./with-action";

/**
 * Formulations Server Actions
 * Server-side functions for formulation CRUD operations
 */

import { z } from "zod";
import { createFormulation, updateFormulation, deleteFormulation } from "@/lib/operations/formulations";
import { runOperationInProcess } from "@/lib/operations/runner";
import {
  getFormulations as getFormulationsData,
  getFormulationById as getFormulationByIdData,
  type FormulationWithIngredients,
  type PaginatedFormulations,
} from "@/data-access/formulations";
import {
  createFormulationSchema,
  deleteFormulationSchema,
  updateFormulationSchema,
  formulationFilterSchema,
} from "@/schemas/formulations";
import type { ActionResult } from "@/types/actions";

const LOG_MESSAGE = "formulation action failed";

// ============================================
// Formulation List/Query Operations
// ============================================

/**
 * Get paginated list of formulations with filtering
 */
export async function getFormulationsFn(
  filters?: Partial<z.infer<typeof formulationFilterSchema>>
): Promise<ActionResult<PaginatedFormulations>> {
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? formulationFilterSchema.parse(filters)
      : undefined;
    const formulations = await getFormulationsData(ctx, validatedFilters);

    return formulations;
  }, {
    fallbackMessage: "Failed to load formulations",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: LOG_MESSAGE, context: { op: "formulation:list" } },
  });
}

/**
 * Get a single formulation by ID (with ingredients)
 */
export async function getFormulationByIdFn(
  formulationId: string
): Promise<ActionResult<FormulationWithIngredients>> {
  return withAction(async (ctx) => {
    const formulation = await getFormulationByIdData(ctx, formulationId);
    return formulation;
  }, {
    fallbackMessage: "Failed to load formulation",
    log: { message: LOG_MESSAGE, context: { op: "formulation:get" } },
  });
}

// ============================================
// Formulation Create Operations
// ============================================

/**
 * Create a new formulation with optional ingredients
 */
export async function createFormulationFn(
  data: z.infer<typeof createFormulationSchema>
): Promise<ActionResult<FormulationWithIngredients>> {
  return withAction(async (ctx) => {
    const validated = createFormulationSchema.parse(data);

    const formulation = await runOperationInProcess(createFormulation, ctx, {
      name: validated.name,
      biocharRatio: validated.biocharRatio ?? null,
      description: validated.description || null,
      lines: validated.ingredients?.map(({ feedstockTypeId, ratio }) => ({ feedstockTypeId, ratio: ratio ?? null })),
    });

    return formulation;
  }, {
    fallbackMessage: "Failed to create formulation",
    log: { message: LOG_MESSAGE, context: { op: "formulation:create" } },
  });
}

// ============================================
// Formulation Update Operations
// ============================================

/**
 * Update an existing formulation with ingredients
 */
export async function updateFormulationFn(
  data: z.infer<typeof updateFormulationSchema>
): Promise<ActionResult<FormulationWithIngredients>> {
  return withAction(async (ctx) => {

    const validated = updateFormulationSchema.parse(data);

    const formulation = await runOperationInProcess(updateFormulation, ctx, {
      formulationId: validated.formulationId,
      expectedVersion: validated.expectedVersion,
      code: validated.code,
      name: validated.name,
      biocharRatio: validated.biocharRatio,
      description: validated.description === undefined ? undefined : validated.description || null,
      lines: validated.ingredients?.map((ing) => ({
        feedstockTypeId: ing.feedstockTypeId,
        ratio: ing.ratio ?? null,
      })),
    });

    return formulation;
  }, { fallbackMessage: "Failed to update formulation", log: { message: LOG_MESSAGE, context: { op: "formulation:update" } } });
}

// ============================================
// Formulation Delete Operations
// ============================================

/**
 * Delete a formulation (ingredients cascade via FK)
 */
export async function deleteFormulationFn(
  data: z.infer<typeof deleteFormulationSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {

    const validated = deleteFormulationSchema.parse(data);
    await runOperationInProcess(deleteFormulation, ctx, validated);

    return undefined;
  }, { fallbackMessage: "Failed to delete formulation", log: { message: LOG_MESSAGE, context: { op: "formulation:delete" } } });
}
