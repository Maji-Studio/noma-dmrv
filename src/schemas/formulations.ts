/**
 * Formulation Validation Schemas
 * Zod schemas for formulation forms, server actions, and filtering
 */

import { z } from "zod";

// ============================================
// Constants
// ============================================

export const FORMULATION_LINE_FEEDSTOCK_USAGE = "blend" as const;

// ============================================
// Ratio Sum Constraint (issue #282)
// ============================================

/**
 * A formulation's ratios partition the *solid* blend — water is tracked
 * separately on the product (`waterAddedKg`) — so biochar + ingredient ratios
 * can never sum to more than the whole, 1.0.
 */
export const RATIO_SUM_MAX = 1;

/**
 * Absolute tolerance when comparing the combined ratio to {@link RATIO_SUM_MAX}.
 * Percentage entry (70 + 30, 33 + 33 + 34) is exact; the tolerance only absorbs
 * floating-point artifacts, never a real over-allocation.
 */
export const RATIO_SUM_TOLERANCE = 1e-6;

export const RATIO_SUM_EXCEEDED_MESSAGE =
  "Biochar and ingredient ratios add up to more than 100% of the blend. Reduce them so the total is 100% or less.";

/** Combined biochar + ingredient ratio, treating missing ratios as 0. */
export function formulationRatioSum(
  biocharRatio: number | null | undefined,
  ingredients: ReadonlyArray<{ ratio?: number | null }> | null | undefined,
): number {
  const ingredientSum = (ingredients ?? []).reduce(
    (total, ingredient) => total + (ingredient?.ratio ?? 0),
    0,
  );
  return (biocharRatio ?? 0) + ingredientSum;
}

/** True when the combined ratio exceeds 100% beyond {@link RATIO_SUM_TOLERANCE}. */
export function exceedsFormulationRatioSum(
  biocharRatio: number | null | undefined,
  ingredients: ReadonlyArray<{ ratio?: number | null }> | null | undefined,
): boolean {
  return (
    formulationRatioSum(biocharRatio, ingredients) >
    RATIO_SUM_MAX + RATIO_SUM_TOLERANCE
  );
}

/**
 * Shared refinement flagging `biocharRatio` when the blend over-allocates.
 * On update payloads this only guards when both ratios are present; the
 * data-access layer reconciles the effective post-update state when one side
 * is omitted.
 */
function ratioSumRefinement(
  data: {
    biocharRatio?: number | null;
    ingredients?: ReadonlyArray<{ ratio?: number | null }>;
  },
  ctx: z.RefinementCtx,
) {
  if (exceedsFormulationRatioSum(data.biocharRatio, data.ingredients)) {
    ctx.addIssue({
      code: "custom",
      path: ["biocharRatio"],
      message: RATIO_SUM_EXCEEDED_MESSAGE,
    });
  }
}

// ============================================
// Ratio Validation (0 to 1)
// ============================================

const optionalRatioSchema = z
  .number()
  .min(0, "Ratio must be between 0 and 1")
  .max(1, "Ratio must be between 0 and 1")
  .optional()
  .nullable();

// ============================================
// Ingredient Schema
// ============================================

export const formulationIngredientSchema = z.object({
  feedstockTypeId: z
    .string()
    .min(1, "Blend material is required")
    .uuid("Select a valid blend material"),
  ratio: optionalRatioSchema,
});

export type FormulationIngredientFormData = z.infer<
  typeof formulationIngredientSchema
>;

// ============================================
// Formulation Form Schema (Client-side validation)
// ============================================

export const formulationFormSchema = z
  .object({
    name: z
      .string()
      .min(1, "Formulation name is required")
      .max(255, "Formulation name must be less than 255 characters"),

    biocharRatio: optionalRatioSchema,

    description: z
      .string()
      .max(1000, "Description must be less than 1000 characters")
      .optional()
      .or(z.literal("")),

    ingredients: z.array(formulationIngredientSchema).optional(),
  })
  .superRefine(ratioSumRefinement);

// ============================================
// Server Action Schemas - Formulation
// ============================================

export const createFormulationSchema = formulationFormSchema;

export const updateFormulationSchema = z
  .object({
    formulationId: z.string().uuid("Invalid formulation ID"),
    code: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[A-Z0-9-]+$/)
      .optional(),
    name: z.string().min(1).max(255).optional(),
    biocharRatio: optionalRatioSchema,
    description: z.string().max(1000).optional().nullable().or(z.literal("")),
    ingredients: z.array(formulationIngredientSchema).optional(),
  })
  .superRefine(ratioSumRefinement);

export const deleteFormulationSchema = z.object({
  formulationId: z.string().uuid("Invalid formulation ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

export const formulationFilterSchema = z.object({
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  sortBy: z
    .enum(["code", "name", "biocharRatio", "createdAt", "updatedAt"])
    .default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const formulationSelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});

// ============================================
// Type Inference
// ============================================

export type FormulationFormData = z.infer<typeof formulationFormSchema>;
export type CreateFormulationData = z.infer<typeof createFormulationSchema>;
export type UpdateFormulationData = z.infer<typeof updateFormulationSchema>;
export type DeleteFormulationData = z.infer<typeof deleteFormulationSchema>;
export type FormulationFilterData = z.infer<typeof formulationFilterSchema>;
export type FormulationSelectData = z.infer<typeof formulationSelectSchema>;
