/**
 * Production Samples Zod Schemas
 * Validation schemas for in-process field measurements during pyrolysis runs
 */

import { z } from "zod";
import { emptyToNull, optionalNumber, optionalPercent } from "./helpers";

// ============================================
// Form Schema
// ============================================

export const productionSampleFormSchema = z.object({
  productionRunId: z.string().uuid("Production run is required"),
  timestamp: z.string().min(1, "Timestamp is required"),

  // Physical measurements
  weightGrams: optionalNumber,
  volumeMl: optionalNumber,
  temperatureC: optionalNumber,

  // Proximate analysis
  moistureContentPercent: optionalPercent,
  fixedCarbonPercent: optionalPercent,
  volatileMatterPercent: optionalPercent,
  ashContentPercent: optionalPercent,

  // Metadata
  photoUrl: emptyToNull.or(z.string().url()).nullable().optional(),
  sampledById: emptyToNull.or(z.string().uuid()).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type ProductionSampleFormData = z.infer<
  typeof productionSampleFormSchema
>;

// ============================================
// Server Action Schemas
// ============================================

export const createProductionSampleSchema = productionSampleFormSchema;
export type CreateProductionSampleData = z.infer<
  typeof createProductionSampleSchema
>;

export const updateProductionSampleSchema = z.object({
  productionSampleId: z.string().uuid("Sample ID is required"),
  ...productionSampleFormSchema.shape,
});
export type UpdateProductionSampleData = z.infer<
  typeof updateProductionSampleSchema
>;

export const deleteProductionSampleSchema = z.object({
  productionSampleId: z.string().uuid("Sample ID is required"),
});
export type DeleteProductionSampleData = z.infer<
  typeof deleteProductionSampleSchema
>;
