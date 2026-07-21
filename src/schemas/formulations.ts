/**
 * Formulation Validation Schemas
 * Zod schemas for formulation forms, server actions, and filtering
 *
 * Two vocabularies on purpose: the UI speaks percent (0–100, whole-number
 * friendly), storage and server contracts speak ratio (0–1, `numeric(7,6)`).
 * The percent form schema + converters at the bottom own the translation.
 */

import { z } from "zod";
import { optionalPercent } from "./helpers";

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
      .trim()
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
    name: z.string().trim().min(1).max(255).optional(),
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
// Percent-Based Form Entry (UI vocabulary)
// ============================================

/**
 * Ratios persist as `numeric(7,6)` (6 decimals), so 4 decimals of a percent
 * round-trip exactly. Both converters round to that precision to keep
 * percent ⇄ ratio conversion stable across edit round-trips.
 */
const PERCENT_DECIMALS = 10_000;
const RATIO_DECIMALS = 1_000_000;

/** Ratio (0–1) → display percent (0–100), null-safe. */
export function ratioToPercent(ratio: number | null | undefined): number | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return Math.round(ratio * 100 * PERCENT_DECIMALS) / PERCENT_DECIMALS;
}

/** Entered percent (0–100) → stored ratio (0–1), null-safe. */
export function percentToRatio(percent: number | null | undefined): number | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  return Math.round((percent / 100) * RATIO_DECIMALS) / RATIO_DECIMALS;
}

export const formulationIngredientPercentSchema = z.object({
  feedstockTypeId: z
    .string()
    .min(1, "Blend material is required")
    .uuid("Select a valid blend material"),
  sharePercent: optionalPercent,
});

/** True when the combined biochar + ingredient shares exceed 100%. */
export function exceedsFormulationPercentSum(
  biocharPercent: number | null | undefined,
  ingredients:
    | ReadonlyArray<{ sharePercent?: number | null }>
    | null
    | undefined,
): boolean {
  return exceedsFormulationRatioSum(
    percentToRatio(biocharPercent),
    (ingredients ?? []).map((ingredient) => ({
      ratio: percentToRatio(ingredient?.sharePercent),
    })),
  );
}

/** Combined biochar + ingredient share in percent, missing shares as 0. */
export function formulationPercentSum(
  biocharPercent: number | null | undefined,
  ingredients:
    | ReadonlyArray<{ sharePercent?: number | null }>
    | null
    | undefined,
): number {
  const ingredientSum = (ingredients ?? []).reduce(
    (total, ingredient) => total + (ingredient?.sharePercent ?? 0),
    0,
  );
  return (biocharPercent ?? 0) + ingredientSum;
}

export const PERCENT_SUM_EXCEEDED_MESSAGE =
  "Biochar and ingredient shares add up to more than 100% of the blend. Reduce them so the total is 100% or less.";

export const formulationPercentFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Formulation name is required")
      .max(255, "Formulation name must be less than 255 characters"),

    biocharPercent: optionalPercent,

    description: z
      .string()
      .max(1000, "Description must be less than 1000 characters")
      .optional()
      .or(z.literal("")),

    ingredients: z.array(formulationIngredientPercentSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (exceedsFormulationPercentSum(data.biocharPercent, data.ingredients)) {
      ctx.addIssue({
        code: "custom",
        path: ["biocharPercent"],
        message: PERCENT_SUM_EXCEEDED_MESSAGE,
      });
    }
  });

export type FormulationPercentFormData = z.infer<
  typeof formulationPercentFormSchema
>;

/** Map the percent-entry form payload to the ratio-based server contract. */
export function percentFormToRatioPayload(
  data: FormulationPercentFormData,
): FormulationFormData {
  return {
    name: data.name,
    biocharRatio: percentToRatio(data.biocharPercent),
    description: data.description,
    ingredients: data.ingredients?.map((ingredient) => ({
      feedstockTypeId: ingredient.feedstockTypeId,
      ratio: percentToRatio(ingredient.sharePercent),
    })),
  };
}

// ============================================
// Type Inference
// ============================================

export type FormulationFormData = z.infer<typeof formulationFormSchema>;
export type CreateFormulationData = z.infer<typeof createFormulationSchema>;
export type UpdateFormulationData = z.infer<typeof updateFormulationSchema>;
export type DeleteFormulationData = z.infer<typeof deleteFormulationSchema>;
export type FormulationFilterData = z.infer<typeof formulationFilterSchema>;
export type FormulationSelectData = z.infer<typeof formulationSelectSchema>;
