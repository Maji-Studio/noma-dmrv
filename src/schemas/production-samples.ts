import { expectedVersionSchema } from "./helpers";
/**
 * Production Samples Zod Schemas
 * Validation schemas for in-process field measurements during pyrolysis runs
 */

import { z } from "zod";
import { emptyToNull, optionalNumber, optionalPercent, optionalPositiveNumber } from "./helpers";

import { createEventInstantSchema } from "./event-instant";

const MEASURED_FIELDS = ["weightGrams", "volumeMl", "temperatureC", "moistureContentPercent", "fixedCarbonPercent", "volatileMatterPercent", "ashContentPercent"] as const;

// ============================================
// Form Schema
// ============================================

export const productionSampleFormSchema = z.object({
  productionRunId: z.string().uuid("Production run is required"),
  timestamp: createEventInstantSchema("Enter the measurement time."),

  // Physical measurements
  weightGrams: optionalPositiveNumber,
  volumeMl: optionalPositiveNumber,
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
}).refine((data) => MEASURED_FIELDS.some((field) => data[field] != null), {
  path: ["weightGrams"],
  message: "Enter at least one measured value.",
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

export const updateProductionSampleSchema = productionSampleFormSchema.safeExtend({
  expectedVersion: expectedVersionSchema,
  productionSampleId: z.string().uuid("Choose a valid in-process measurement."),
});
export type UpdateProductionSampleData = z.infer<
  typeof updateProductionSampleSchema
>;

export const deleteProductionSampleSchema = z.object({
  expectedVersion: expectedVersionSchema,
  productionSampleId: z.string().uuid("Choose a valid in-process measurement."),
});

export type DeleteProductionSampleData = z.infer<typeof deleteProductionSampleSchema>;
