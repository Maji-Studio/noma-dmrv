"use server";

/**
 * Formulations Server Actions
 * Server-side functions for formulation CRUD operations
 */

import { z } from "zod";
import { formulations } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import {
  createFormulation,
  deleteFormulation,
  getFormulations as getFormulationsData,
  getFormulationById as getFormulationByIdData,
  isFormulationCodeAvailable as isFormulationCodeAvailableData,
  getFormulationOptions as getFormulationOptionsData,
  updateFormulation,
  type FormulationWithIngredients,
  type PaginatedFormulations,
} from "@/data-access/formulations";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createFormulationSchema,
  deleteFormulationSchema,
  updateFormulationSchema,
  formulationFilterSchema,
} from "@/schemas/formulations";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

function formulationActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "formulation action failed",
    context: { op },
  });
}

// ============================================
// Formulation List/Query Operations
// ============================================

/**
 * Get paginated list of formulations with filtering
 */
export async function getFormulationsFn(
  filters?: Partial<z.infer<typeof formulationFilterSchema>>
): Promise<ActionResult<PaginatedFormulations>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? formulationFilterSchema.parse(filters)
      : undefined;
    const formulations = await getFormulationsData(ctx, validatedFilters);

    return { success: true, data: formulations };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: formulationActionError(
        error,
        "Failed to load formulations",
        "formulation:list",
      ),
    };
  }
}

/**
 * Get a single formulation by ID (with ingredients)
 */
export async function getFormulationByIdFn(
  formulationId: string
): Promise<ActionResult<FormulationWithIngredients>> {
  try {
    const ctx = await requireOrgContext();

    const formulation = await getFormulationByIdData(ctx, formulationId);
    return { success: true, data: formulation };
  } catch (error) {
    return {
      success: false,
      error: formulationActionError(
        error,
        "Failed to load formulation",
        "formulation:get",
      ),
    };
  }
}

/**
 * Get formulation options for dropdowns
 */
export async function getFormulationOptionsFn(): Promise<
  ActionResult<Array<{ id: string; code: string; name: string }>>
> {
  try {
    const ctx = await requireOrgContext();

    const options = await getFormulationOptionsData(ctx);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error: formulationActionError(
        error,
        "Failed to load formulation options",
        "formulation:options",
      ),
    };
  }
}

/**
 * Check if a formulation code is available
 */
export async function checkFormulationCodeFn(
  code: string,
  excludeFormulationId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const ctx = await requireOrgContext();

    const available = await isFormulationCodeAvailableData(
      ctx,
      code,
      excludeFormulationId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: formulationActionError(
        error,
        "Failed to check formulation code",
        "formulation:check-code",
      ),
    };
  }
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
  try {
    const ctx = await requireOrgContext();

    const validated = createFormulationSchema.parse(data);

    const formulation = await withAutoCode(
      ctx,
      "BCF",
      formulations,
      formulations.code,
      undefined,
      (code) =>
        createFormulation(ctx, {
          code,
          name: validated.name,
          biocharRatio: validated.biocharRatio ?? null,
          description: validated.description || null,
          ingredients: validated.ingredients?.map((ing) => ({
            feedstockTypeId: ing.feedstockTypeId,
            ratio: ing.ratio ?? null,
          })),
        }),
      CODE_CONFLICT_MESSAGES.formulation,
    );

    return { success: true, data: formulation };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: formulationActionError(
        error,
        "Failed to create formulation",
        "formulation:create",
      ),
    };
  }
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
  try {
    const ctx = await requireOrgContext();

    const validated = updateFormulationSchema.parse(data);

    const formulation = await updateFormulation(ctx, validated.formulationId, {
      code: validated.code,
      name: validated.name,
      biocharRatio: validated.biocharRatio,
      description: validated.description || null,
      ingredients: validated.ingredients?.map((ing) => ({
        feedstockTypeId: ing.feedstockTypeId,
        ratio: ing.ratio ?? null,
      })),
    });

    return { success: true, data: formulation };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: formulationActionError(
        error,
        "Failed to update formulation",
        "formulation:update",
      ),
    };
  }
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
  try {
    const ctx = await requireOrgContext();

    const validated = deleteFormulationSchema.parse(data);
    await deleteFormulation(ctx, validated.formulationId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: formulationActionError(
        error,
        "Failed to delete formulation",
        "formulation:delete",
      ),
    };
  }
}
