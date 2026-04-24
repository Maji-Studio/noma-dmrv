/**
 * Samples Validation Schemas
 * Zod schemas for lab sample tracking forms, server actions, and filtering
 * Linked to production runs per Isometric Protocol Section 8.3
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";

// ============================================
// Constants
// ============================================

const optionalNumber = z
  .union([
    z.number().finite(),
    z.string().transform((val) => (val === "" ? null : parseFloat(val))),
    z.null(),
  ])
  .optional()
  .nullable();

const requiredNumber = z.union([
  z.number().finite(),
  z.string().transform((val) => {
    if (val === "") return undefined;
    const num = parseFloat(val);
    if (isNaN(num)) return undefined;
    return num;
  }),
]).refine((val) => val !== undefined, { message: "This field is required" });

// ============================================
// Sample Form Schema (Client-side validation)
// ============================================

/**
 * Schema for sample form (client-side validation)
 * Used in SampleForm component for creating/editing samples
 *
 * Form sections:
 * 1. Sample Info — code, samplingTime, production run
 * 2. Carbon Analysis — totalCarbonPercent, organicCarbonPercent, inorganicCarbonPercent
 * 3. Elemental — H, N, O, S percentages
 * 4. Proximate — ash, volatile matter, moisture
 * 5. Physical — bulkDensity, pH, surfaceArea
 * 6. Stability — hToCOrgRatio (calculated)
 * 7. 1000-Year Durability (conditional) — R₀ reflectance, TGA non-reactive carbon
 */
export const sampleFormSchema = z
  .object({
    // === Section 1: Sample Info ===
    productionRunId: z.string().min(1, "Please select a production run").uuid("Invalid production run"),
    samplingTime: z.union([
      z.date(),
      z.string().transform((val, ctx) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
          return z.NEVER;
        }
        return date;
      }),
    ]),

    // Lab info (optional)
    labName: z.string().max(200).optional().nullable().or(z.literal("")),
    labAccreditation: z.string().max(200).optional().nullable().or(z.literal("")),
    analysisDate: z.union([
      z.date(),
      z.string().transform((val) => (val ? new Date(val) : null)),
      z.null(),
    ]).optional().nullable(),

    // Sample weight/volume
    weightGrams: optionalNumber,
    volumeMl: optionalNumber,

    // === Section 2: Carbon Analysis ===
    totalCarbonPercent: requiredNumber,
    organicCarbonPercent: requiredNumber,
    inorganicCarbonPercent: optionalNumber,

    // === Section 3: Elemental ===
    totalHydrogenPercent: optionalNumber,
    totalNitrogenPercent: optionalNumber,
    totalOxygenPercent: optionalNumber,
    totalSulfurPercent: optionalNumber,

    // === Section 4: Proximate ===
    ashContentPercent: optionalNumber,
    moistureContentPercent: optionalNumber,
    volatileMatterPercent: optionalNumber,

    // === Section 5: Physical ===
    bulkDensityKgPerM3: optionalNumber,
    ph: optionalNumber,
    surfaceAreaM2PerG: optionalNumber,
    saltContentGPerKg: optionalNumber,

    // === Section 6: Stability ===
    // H:C org ratio - can be calculated from totalHydrogenPercent / organicCarbonPercent
    hToCOrgRatio: optionalNumber,
    oToCOrgRatio: optionalNumber,

    // === Section 7: 1000-Year Durability (conditional) ===
    durabilityOption: z.enum(["200_year", "1000_year"]).default("200_year"),

    // R₀ reflectance (required for 1000-year)
    randomReflectanceR0Percent: optionalNumber,
    r0MeasurementCount: z.union([
      z.number().int().min(0),
      z.string().transform((val) => (val === "" ? null : parseInt(val, 10))),
      z.null(),
    ]).optional().nullable(),
    r0AnalysisDate: z.union([
      z.date(),
      z.string().transform((val) => (val ? new Date(val) : null)),
      z.null(),
    ]).optional().nullable(),
    r0HistogramFileUrl: z.string().max(2000).optional().nullable().or(z.literal("")),

    // TGA non-reactive carbon (required for 1000-year)
    reactiveCarbonPercent: optionalNumber,
    residualCarbonPercent: optionalNumber,
    tgaAnalysisDate: z.union([
      z.date(),
      z.string().transform((val) => (val ? new Date(val) : null)),
      z.null(),
    ]).optional().nullable(),
    tgaThermogramFileUrl: z.string().max(2000).optional().nullable().or(z.literal("")),

    // === Nutrient Claims (from sampleConditionSchema) ===
    nutrientClaimEnabled: z.boolean().default(false),
    phosphorusPercent: optionalNumber,
    potassiumPercent: optionalNumber,
    magnesiumPercent: optionalNumber,
    calciumPercent: optionalNumber,
    ironPercent: optionalNumber,
  })
  .superRefine((value, ctx) => {
    // Conditional validation for 1000-year durability
    if (value.durabilityOption === "1000_year") {
      if (value.randomReflectanceR0Percent == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["randomReflectanceR0Percent"],
          message: "R₀ reflectance is required for 1000-year durability",
        });
      }

      if (value.residualCarbonPercent == null && value.reactiveCarbonPercent == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["residualCarbonPercent"],
          message: "TGA non-reactive carbon data is required for 1000-year durability",
        });
      }
    }

    // Conditional validation for nutrient claims
    if (value.nutrientClaimEnabled) {
      const nutrientFields = [
        { key: "phosphorusPercent", name: "Phosphorus %" },
        { key: "potassiumPercent", name: "Potassium %" },
        { key: "magnesiumPercent", name: "Magnesium %" },
        { key: "calciumPercent", name: "Calcium %" },
        { key: "ironPercent", name: "Iron %" },
      ] as const;

      for (const { key, name } of nutrientFields) {
        if (value[key] == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${name} is required when nutrient claims are enabled`,
          });
        }
      }
    }
  });

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a sample (server action)
 */
export const createSampleSchema = sampleFormSchema;

/**
 * Schema for updating a sample (server action)
 * All fields optional except sampleId
 */
export const updateSampleSchema = z.object({
  sampleId: z.string().uuid("Invalid sample ID"),
  sampleCode: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  productionRunId: z.string().uuid().optional(),
  samplingTime: z.union([
    z.date(),
    z.string().transform((val, ctx) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
        return z.NEVER;
      }
      return date;
    }),
  ]).optional(),
  labName: z.string().max(200).optional().nullable(),
  labAccreditation: z.string().max(200).optional().nullable(),
  analysisDate: z.union([
    z.date(),
    z.string().transform((val) => (val ? new Date(val) : null)),
    z.null(),
  ]).optional().nullable(),
  weightGrams: z.number().optional().nullable(),
  volumeMl: z.number().optional().nullable(),
  totalCarbonPercent: z.number().optional(),
  organicCarbonPercent: z.number().optional(),
  inorganicCarbonPercent: z.number().optional().nullable(),
  totalHydrogenPercent: z.number().optional().nullable(),
  totalNitrogenPercent: z.number().optional().nullable(),
  totalOxygenPercent: z.number().optional().nullable(),
  totalSulfurPercent: z.number().optional().nullable(),
  ashContentPercent: z.number().optional().nullable(),
  moistureContentPercent: z.number().optional().nullable(),
  volatileMatterPercent: z.number().optional().nullable(),
  bulkDensityKgPerM3: z.number().optional().nullable(),
  ph: z.number().optional().nullable(),
  surfaceAreaM2PerG: z.number().optional().nullable(),
  saltContentGPerKg: z.number().optional().nullable(),
  hToCOrgRatio: z.number().optional().nullable(),
  oToCOrgRatio: z.number().optional().nullable(),
  durabilityOption: z.enum(["200_year", "1000_year"]).optional(),
  randomReflectanceR0Percent: z.number().optional().nullable(),
  r0MeasurementCount: z.number().int().optional().nullable(),
  r0AnalysisDate: z.union([z.date(), z.string(), z.null()]).optional().nullable(),
  r0HistogramFileUrl: z.string().max(2000).optional().nullable(),
  reactiveCarbonPercent: z.number().optional().nullable(),
  residualCarbonPercent: z.number().optional().nullable(),
  tgaAnalysisDate: z.union([z.date(), z.string(), z.null()]).optional().nullable(),
  tgaThermogramFileUrl: z.string().max(2000).optional().nullable(),
  nutrientClaimEnabled: z.boolean().optional(),
  phosphorusPercent: z.number().optional().nullable(),
  potassiumPercent: z.number().optional().nullable(),
  magnesiumPercent: z.number().optional().nullable(),
  calciumPercent: z.number().optional().nullable(),
  ironPercent: z.number().optional().nullable(),
});

/**
 * Schema for deleting a sample
 */
export const deleteSampleSchema = z.object({
  sampleId: z.string().uuid("Invalid sample ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering samples in list views
 * Used for search, pagination, and filtering
 */
export const sampleFilterSchema = z.object({
  // Text search across sample code
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by production run
  productionRunId: z.string().uuid().optional(),

  // Filter by facility through the linked production run
  facilityId: z.string().uuid().optional(),

  // Filter by durability option
  durabilityOption: z.enum(["200_year", "1000_year"]).optional(),

  // Date range filter
  startDate: z.date().optional(),
  endDate: z.date().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["sampleCode", "samplingTime", "totalCarbonPercent", "createdAt", "updatedAt"])
    .default("samplingTime"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ============================================
// Type Inference
// ============================================

export type SampleFormData = z.infer<typeof sampleFormSchema>;
export type CreateSampleData = z.infer<typeof createSampleSchema>;
export type UpdateSampleData = z.infer<typeof updateSampleSchema>;
export type DeleteSampleData = z.infer<typeof deleteSampleSchema>;
export type SampleFilterData = z.infer<typeof sampleFilterSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate H:C org ratio from hydrogen and organic carbon percentages
 */
export function calculateHToCOrgRatio(
  hydrogenPercent: number | null | undefined,
  organicCarbonPercent: number | null | undefined
): number | null {
  if (hydrogenPercent == null || organicCarbonPercent == null || organicCarbonPercent === 0) {
    return null;
  }
  // Atomic ratio: (H% / 1.008) / (Corg% / 12.011)
  return (hydrogenPercent / 1.008) / (organicCarbonPercent / 12.011);
}

/**
 * Calculate O:C org ratio from oxygen and organic carbon percentages
 */
export function calculateOToCOrgRatio(
  oxygenPercent: number | null | undefined,
  organicCarbonPercent: number | null | undefined
): number | null {
  if (oxygenPercent == null || organicCarbonPercent == null || organicCarbonPercent === 0) {
    return null;
  }
  // Atomic ratio: (O% / 15.999) / (Corg% / 12.011)
  return (oxygenPercent / 15.999) / (organicCarbonPercent / 12.011);
}

/**
 * Format durability option for display
 */
export function formatDurabilityOption(option: "200_year" | "1000_year"): string {
  const labels = {
    "200_year": "200-Year",
    "1000_year": "1000-Year",
  };
  return labels[option];
}
