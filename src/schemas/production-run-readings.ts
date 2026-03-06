/**
 * Production Run Readings Validation Schemas
 * Zod schemas for reading forms and server actions
 */

import { z } from "zod";
import { toNumberOrNull } from "./helpers";

// ============================================
// Form Schema (Client-side validation)
// ============================================

export const productionRunReadingFormSchema = z.object({
  productionRunId: z
    .string()
    .min(1, "Please select a production run")
    .uuid("Please select a valid production run"),
  timestamp: z.union([
    z.date(),
    z
      .string()
      .min(1, "Please enter a timestamp")
      .transform((val, ctx) => {
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) return val;
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid timestamp",
          });
          return z.NEVER;
        }
        return date;
      }),
  ]),
  temperatureC: z.preprocess(
    toNumberOrNull,
    z.number().nullable().optional()
  ),
  pressureBar: z.preprocess(
    toNumberOrNull,
    z.number().nullable().optional()
  ),
  gasFlowRate: z.preprocess(
    toNumberOrNull,
    z.number().nullable().optional()
  ),
});

// ============================================
// Server Action Schemas
// ============================================

export const createProductionRunReadingSchema = productionRunReadingFormSchema;

export const productionRunReadingListFiltersSchema = z.object({
  productionRunId: z.string().uuid("Invalid production run ID").optional(),
  facilityId: z.string().uuid("Invalid facility ID").optional(),
});

export const updateProductionRunReadingSchema = z.object({
  readingId: z.string().uuid("Invalid reading ID"),
  timestamp: z
    .union([
      z.date(),
      z.string().transform((val, ctx) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid timestamp",
          });
          return z.NEVER;
        }
        return date;
      }),
    ])
    .optional(),
  temperatureC: z.number().nullable().optional(),
  pressureBar: z.number().nullable().optional(),
  gasFlowRate: z.number().nullable().optional(),
});

export const deleteProductionRunReadingSchema = z.object({
  readingId: z.string().uuid("Invalid reading ID"),
});

// ============================================
// Type Inference
// ============================================

export type ProductionRunReadingFormData = z.infer<
  typeof productionRunReadingFormSchema
>;
export type CreateProductionRunReadingData = z.infer<
  typeof createProductionRunReadingSchema
>;
export type UpdateProductionRunReadingData = z.infer<
  typeof updateProductionRunReadingSchema
>;
export type DeleteProductionRunReadingData = z.infer<
  typeof deleteProductionRunReadingSchema
>;
