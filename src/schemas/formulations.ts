/**
 * Formulation Validation Schemas
 * Zod schemas for formulation forms, server actions, and filtering
 */

import { z } from "zod";

// ============================================
// Constants
// ============================================

export const INGREDIENT_TYPES = [
  "compost",
  "mineral",
  "lime",
  "binder",
  "amendment",
  "other",
] as const;

export const INGREDIENT_TYPE_LABELS: Record<
  (typeof INGREDIENT_TYPES)[number],
  string
> = {
  compost: "Compost",
  mineral: "Mineral",
  lime: "Lime",
  binder: "Binder",
  amendment: "Amendment",
  other: "Other",
};

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
  ingredientType: z.enum(INGREDIENT_TYPES, {
    error: "Ingredient type is required",
  }),
  name: z
    .string()
    .min(1, "Ingredient name is required")
    .max(255, "Name must be less than 255 characters"),
  ratio: optionalRatioSchema,
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

export type FormulationIngredientFormData = z.infer<
  typeof formulationIngredientSchema
>;

// ============================================
// Formulation Form Schema (Client-side validation)
// ============================================

export const formulationFormSchema = z.object({
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
});

// ============================================
// Server Action Schemas - Formulation
// ============================================

export const createFormulationSchema = formulationFormSchema;

export const updateFormulationSchema = z.object({
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
});

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
