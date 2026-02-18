/**
 * Formulation Validation Schemas
 * Zod schemas for formulation forms, server actions, and filtering
 */

import { z } from "zod";

// ============================================
// Ratio Validation (0 to 1)
// ============================================

/**
 * Ratio validation (0 to 1) - Optional for formulations
 */
const optionalRatioSchema = z
  .number()
  .min(0, "Ratio must be between 0 and 1")
  .max(1, "Ratio must be between 0 and 1")
  .optional()
  .nullable();

// ============================================
// Formulation Form Schema (Client-side validation)
// ============================================

/**
 * Schema for formulation form (client-side validation)
 * Used in FormulationForm component for creating/editing formulations
 */
export const formulationFormSchema = z.object({
  // Required fields
  code: z
    .string()
    .max(50, "Formulation code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Formulation code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  name: z
    .string()
    .min(1, "Formulation name is required")
    .max(255, "Formulation name must be less than 255 characters"),

  // Ratio fields
  biocharRatio: z.union([
    z.number().transform((val) => (isNaN(val) ? null : val)).pipe(
      z.number().min(0, "Ratio must be between 0 and 1").max(1, "Ratio must be between 0 and 1").nullable()
    ),
    z.string().transform((val, ctx) => {
      if (val === "") return null;
      const num = parseFloat(val);
      if (isNaN(num) || num < 0 || num > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ratio must be between 0 and 1" });
        return z.NEVER;
      }
      return num;
    }),
    z.null(),
  ]).optional().nullable(),
  compostRatio: z.union([
    z.number().transform((val) => (isNaN(val) ? null : val)).pipe(
      z.number().min(0, "Ratio must be between 0 and 1").max(1, "Ratio must be between 0 and 1").nullable()
    ),
    z.string().transform((val, ctx) => {
      if (val === "") return null;
      const num = parseFloat(val);
      if (isNaN(num) || num < 0 || num > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ratio must be between 0 and 1" });
        return z.NEVER;
      }
      return num;
    }),
    z.null(),
  ]).optional().nullable(),

  // Optional fields
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas - Formulation
// ============================================

/**
 * Schema for creating a formulation (server action)
 * Same as form schema - all required fields must be present
 */
export const createFormulationSchema = formulationFormSchema;

/**
 * Schema for updating a formulation (server action)
 * All fields optional except formulationId
 */
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
  compostRatio: optionalRatioSchema,
  description: z.string().max(1000).optional().nullable().or(z.literal("")),
});

/**
 * Schema for deleting a formulation
 */
export const deleteFormulationSchema = z.object({
  formulationId: z.string().uuid("Invalid formulation ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering formulations in list views
 * Used for search, pagination, and filtering
 */
export const formulationFilterSchema = z.object({
  // Text search across code, name, description
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "name", "biocharRatio", "compostRatio", "createdAt", "updatedAt"])
    .default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Schema for selecting a formulation (e.g., in dropdowns)
 */
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
