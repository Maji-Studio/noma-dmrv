"use server";

/**
 * Formulations Server Actions
 * Server-side functions for formulation CRUD operations
 */

import { z } from "zod";
import { formulations } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
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
import { getUser } from "@/lib/auth/server";
import {
  createFormulationSchema,
  deleteFormulationSchema,
  updateFormulationSchema,
  formulationFilterSchema,
} from "@/schemas/formulations";
import type { ActionResult } from "@/types/actions";

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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? formulationFilterSchema.parse(filters)
      : undefined;
    const formulations = await getFormulationsData(user.id, validatedFilters);

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
      error:
        error instanceof Error ? error.message : "Failed to load formulations",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const formulation = await getFormulationByIdData(user.id, formulationId);
    return { success: true, data: formulation };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load formulation",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const options = await getFormulationOptionsData(user.id);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load formulation options",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isFormulationCodeAvailableData(
      user.id,
      code,
      excludeFormulationId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check formulation code",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createFormulationSchema.parse(data);

    const formulation = await withAutoCode(
      "BCF",
      formulations,
      formulations.code,
      undefined,
      (code) =>
        createFormulation(user.id, {
          code,
          name: validated.name,
          biocharRatio: validated.biocharRatio ?? null,
          description: validated.description || null,
          ingredients: validated.ingredients?.map((ing) => ({
            ingredientType: ing.ingredientType,
            name: ing.name,
            ratio: ing.ratio ?? null,
            description: ing.description || null,
          })),
        })
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
      error:
        error instanceof Error ? error.message : "Failed to create formulation",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateFormulationSchema.parse(data);

    const formulation = await updateFormulation(user.id, validated.formulationId, {
      code: validated.code,
      name: validated.name,
      biocharRatio: validated.biocharRatio,
      description: validated.description,
      ingredients: validated.ingredients?.map((ing) => ({
        ingredientType: ing.ingredientType,
        name: ing.name,
        ratio: ing.ratio ?? null,
        description: ing.description || null,
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
      error:
        error instanceof Error ? error.message : "Failed to update formulation",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteFormulationSchema.parse(data);
    await deleteFormulation(user.id, validated.formulationId);

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
      error:
        error instanceof Error ? error.message : "Failed to delete formulation",
    };
  }
}
