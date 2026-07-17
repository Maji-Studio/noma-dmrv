/**
 * Samples Validation Schemas
 * Zod schemas for lab sample tracking forms, server actions, and filtering
 * A Sample characterises ONE credit batch (the protocol production batch) —
 * Isometric Protocol Section 8.3 / issue #309. The batch's runs are commingled,
 * so no production-run link is captured.
 */

import { z } from "zod";
import {
  optionalNumber,
  optionalPercent,
  PG_INTEGER_MAX,
  requiredNumber,
} from "./helpers";

// ============================================
// Constants
// ============================================

const PERCENT_RANGE_MESSAGE = "Must be 0–100";
const NON_NEGATIVE_NUMBER_MESSAGE = "Must be a non-negative number";
const PH_MIN = 0;
const PH_MAX = 14;
const PH_RANGE_MESSAGE = `Must be between ${PH_MIN} and ${PH_MAX}`;

const percentNumber = z
  .number()
  .finite()
  .min(0, PERCENT_RANGE_MESSAGE)
  .max(100, PERCENT_RANGE_MESSAGE);

const nonNegativeNumber = z
  .number()
  .finite()
  .min(0, NON_NEGATIVE_NUMBER_MESSAGE);

const requiredPercent = requiredNumber("This field is required").pipe(
  percentNumber,
);

const optionalNonNegativeNumber = optionalNumber.pipe(
  nonNegativeNumber.nullable().optional(),
).optional();

const optionalPercentInput = optionalPercent.optional();

const optionalPh = optionalNumber.pipe(
  z
    .number()
    .min(PH_MIN, PH_RANGE_MESSAGE)
    .max(PH_MAX, PH_RANGE_MESSAGE)
    .nullable()
    .optional(),
).optional();

const optionalFraction = optionalNumber.refine(
  (value) => value == null || (value >= 0 && value <= 1),
  { message: "Must be between 0 and 1" },
).optional();

// ============================================
// Sample Form Schema (Client-side validation)
// ============================================

/**
 * Schema for sample form (client-side validation)
 * Used in SampleForm component for creating/editing samples
 *
 * Form sections:
 * 1. Sample Info — code, samplingTime, credit batch
 * 2. Carbon Analysis — totalCarbonPercent, organicCarbonPercent, inorganicCarbonPercent
 * 3. Elemental — H, N, O, S percentages
 * 4. Proximate — ash, moisture
 * 5. Physical — bulkDensity, pH
 * 6. Stability — hToCOrgRatio (calculated)
 * 7. 1000-Year Durability (conditional) — R₀ reflectance, TGA non-reactive carbon
 */
export const sampleFormSchema = z
  .object({
    // === Section 1: Sample Info ===
    // The credit batch (protocol production batch) this lab replicate
    // characterises — required: every sample belongs to exactly one batch
    // (issue #309). The batch pools biochar across its member runs, so the
    // sample never anchors on a production run.
    creditBatchId: z.string().min(1, "Please select a credit batch").uuid("Invalid credit batch"),
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
    weightGrams: optionalNonNegativeNumber,
    volumeMl: optionalNonNegativeNumber,

    // === Section 2: Carbon Analysis ===
    totalCarbonPercent: requiredPercent,
    organicCarbonPercent: requiredPercent,
    // The 200-year durability blueprint consumes `total_carbon_contents` AND
    // `inorganic_carbon_contents` as separate inputs and derives organic via
    // Eq.2 (Total − Inorganic) itself. Kept optional here (not every COA reports
    // it, and hard-requiring would trap in-flight samples) — the per-batch
    // carbon list derives it as max(0, total − organic) when absent (Phase D),
    // so the registry always receives a value without over-crediting.
    inorganicCarbonPercent: optionalPercentInput,

    // === Section 3: Elemental ===
    totalHydrogenPercent: optionalPercentInput,
    totalNitrogenPercent: optionalPercentInput,
    totalOxygenPercent: optionalPercentInput,
    totalSulfurPercent: optionalPercentInput,

    // === Section 4: Proximate ===
    ashContentPercent: optionalPercentInput,
    moistureContentPercent: optionalPercentInput,

    // === Section 5: Physical ===
    bulkDensityKgPerM3: optionalNonNegativeNumber,
    ph: optionalPh,
    saltContentGPerKg: optionalNonNegativeNumber,

    // === Section 6: Stability ===
    // H:C org ratio - can be calculated from totalHydrogenPercent / organicCarbonPercent
    hToCOrgRatio: optionalNonNegativeNumber,
    oToCOrgRatio: optionalNonNegativeNumber,

    // === Section 7: 1000-Year Durability (conditional) ===
    // Not user-selected: the form derives it from the chosen credit batch's
    // declared tier (issue #309) and keeps it in form state so the conditional
    // 1000-year validation below still applies.
    durabilityOption: z.enum(["200_year", "1000_year"]).default("200_year"),

    // R₀ reflectance (required for 1000-year)
    randomReflectanceR0Percent: optionalPercentInput,
    // Proportion of the sample's ISO 7404-5 R₀ readings at or above 2%.
    // Stored/submitted as 0–1; the form presents it as a percentage.
    sReflectanceFraction: optionalFraction,
    r0MeasurementCount: z.union([
      z.number().int().min(0).max(PG_INTEGER_MAX, "Measurement count is too large"),
      z.string()
        .transform((val) => (val === "" ? null : parseInt(val, 10)))
        .pipe(
          z.number().int().min(0).max(PG_INTEGER_MAX, "Measurement count is too large").nullable(),
        ),
      z.null(),
    ]).optional().nullable(),
    r0AnalysisDate: z.union([
      z.date(),
      z.string().transform((val) => (val ? new Date(val) : null)),
      z.null(),
    ]).optional().nullable(),
    r0HistogramFileUrl: z.string().max(2000).optional().nullable().or(z.literal("")),

    // TGA non-reactive carbon (required for 1000-year)
    reactiveCarbonPercent: optionalPercentInput,
    residualCarbonPercent: optionalPercentInput,
    tgaAnalysisDate: z.union([
      z.date(),
      z.string().transform((val) => (val ? new Date(val) : null)),
      z.null(),
    ]).optional().nullable(),
    tgaThermogramFileUrl: z.string().max(2000).optional().nullable().or(z.literal("")),

    // === Nutrient Claims (from sampleConditionSchema) ===
    nutrientClaimEnabled: z.boolean().default(false),
    phosphorusPercent: optionalPercentInput,
    potassiumPercent: optionalPercentInput,
    magnesiumPercent: optionalPercentInput,
    calciumPercent: optionalPercentInput,
    ironPercent: optionalPercentInput,
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

      if (value.sReflectanceFraction == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sReflectanceFraction"],
          message:
            "R₀ readings at or above 2% are required for 1000-year durability",
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
  creditBatchId: z.string().uuid("Invalid credit batch").optional(),
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
  weightGrams: nonNegativeNumber.optional().nullable(),
  volumeMl: nonNegativeNumber.optional().nullable(),
  totalCarbonPercent: percentNumber.optional(),
  organicCarbonPercent: percentNumber.optional(),
  inorganicCarbonPercent: percentNumber.optional().nullable(),
  totalHydrogenPercent: percentNumber.optional().nullable(),
  totalNitrogenPercent: percentNumber.optional().nullable(),
  totalOxygenPercent: percentNumber.optional().nullable(),
  totalSulfurPercent: percentNumber.optional().nullable(),
  ashContentPercent: percentNumber.optional().nullable(),
  moistureContentPercent: percentNumber.optional().nullable(),
  bulkDensityKgPerM3: nonNegativeNumber.optional().nullable(),
  ph: z.number().min(PH_MIN, PH_RANGE_MESSAGE).max(PH_MAX, PH_RANGE_MESSAGE).optional().nullable(),
  saltContentGPerKg: nonNegativeNumber.optional().nullable(),
  hToCOrgRatio: nonNegativeNumber.optional().nullable(),
  oToCOrgRatio: nonNegativeNumber.optional().nullable(),
  durabilityOption: z.enum(["200_year", "1000_year"]).optional(),
  randomReflectanceR0Percent: percentNumber.optional().nullable(),
  sReflectanceFraction: z.number().min(0).max(1).optional().nullable(),
  r0MeasurementCount: z.number().int().min(0).max(PG_INTEGER_MAX, "Measurement count is too large").optional().nullable(),
  r0AnalysisDate: z.union([z.date(), z.string(), z.null()]).optional().nullable(),
  r0HistogramFileUrl: z.string().max(2000).optional().nullable(),
  reactiveCarbonPercent: percentNumber.optional().nullable(),
  residualCarbonPercent: percentNumber.optional().nullable(),
  tgaAnalysisDate: z.union([z.date(), z.string(), z.null()]).optional().nullable(),
  tgaThermogramFileUrl: z.string().max(2000).optional().nullable(),
  nutrientClaimEnabled: z.boolean().optional(),
  phosphorusPercent: percentNumber.optional().nullable(),
  potassiumPercent: percentNumber.optional().nullable(),
  magnesiumPercent: percentNumber.optional().nullable(),
  calciumPercent: percentNumber.optional().nullable(),
  ironPercent: percentNumber.optional().nullable(),
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

  // Filter by credit batch
  creditBatchId: z.string().uuid().optional(),

  // Filter by facility through the linked credit batch
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
