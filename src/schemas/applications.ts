import { z } from "zod";
import {
  gpsPairSuperRefine,
  latitudeSchema,
  longitudeSchema,
  MASS_INPUT_MAX_KG,
  MASS_INPUT_MAX_TONNES,
  MASS_KG_INPUT_STEP,
  MASS_MAX_KG_MESSAGE,
  MASS_MAX_TONNES_MESSAGE,
  MASS_MIN_KG_MESSAGE,
  MASS_MIN_TONNES_MESSAGE,
  MASS_TONNES_INPUT_STEP,
} from "./helpers";
import { gisBoundarySchema } from "./gis-boundary";
import {
  FIELD_SIZE_POSITIVE_MESSAGE,
  FIELD_SIZE_REQUIRED_MESSAGE,
  isPositiveApplicationFieldSize,
} from "@/lib/application-field-size";

// ============================================
// Constants and Enums
// ============================================

/**
 * Soil temperature data sources (Isometric: Soil Storage Module §5.1.1.3.1)
 */
export const soilTemperatureSources = ["baseline", "global_database"] as const;
export type SoilTemperatureSource = (typeof soilTemperatureSources)[number];

/**
 * Application status options
 */
export const applicationStatuses = ["delivered", "applied"] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

/**
 * Application methods
 */
export const applicationMethods = ["manual", "mechanical"] as const;
export type ApplicationMethod = (typeof applicationMethods)[number];

/**
 * Alternative proof-of-spreading methods accepted by the pinned Agricultural
 * Soils v1.1 module.
 */
export const applicationEvidenceMethods = [
  "location",
  "boundary",
  "visual",
] as const;
export type ApplicationEvidenceMethod = (typeof applicationEvidenceMethods)[number];

const CUSTOMER_LOCATION_REQUIRED_MESSAGE =
  "Customer location coordinates are required.";
const positiveFieldSizeHaSchema = z
  .number({ error: FIELD_SIZE_REQUIRED_MESSAGE })
  .refine(isPositiveApplicationFieldSize, FIELD_SIZE_POSITIVE_MESSAGE);

function applicationEvidenceSuperRefine(
  data: {
    evidenceMethod?: ApplicationEvidenceMethod;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  gpsPairSuperRefine(data, ctx);
  if (
    data.evidenceMethod === "location" &&
    data.gpsLatitude == null &&
    data.gpsLongitude == null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["gpsLatitude"],
      message: CUSTOMER_LOCATION_REQUIRED_MESSAGE,
    });
  }
}

/**
 * Validates the effective evidence state after a partial update has been
 * merged with the saved application. A partial payload cannot enforce this
 * invariant by itself because omitted fields retain their stored values.
 */
export const applicationEvidenceStateSchema = z
  .object({
    evidenceMethod: z.enum(applicationEvidenceMethods),
    gpsLatitude: latitudeSchema,
    gpsLongitude: longitudeSchema,
  })
  .superRefine(applicationEvidenceSuperRefine);

// ============================================
// GPS Coordinate Validation
// ============================================

// GPS schemas imported from ./helpers

// ============================================
// Application Form Schema (Client-side validation)
// ============================================

/**
 * Schema for application form (client-side validation)
 * Form sections:
 * 1. Application Details — date, delivery, and biochar product applied
 * 2. Field Details — fieldSizeHa, fieldIdentifier, cropType, GPS coordinates
 * 3. Soil Temperature — soilTemperatureSource, soilTemperatureC
 */
const applicationFormBaseSchema = z.object({
  // === Section 1: Application Details ===
  applicationDate: z.coerce.date({ error: "Application date is required" }),
  deliveryId: z.string().min(1, "Select a delivery.").uuid("Choose a valid delivery."),
  // Hand-rolled rather than `positiveMassKgSchema()` on purpose: the field is
  // entered in kg but stored in tonnes, and seeding the edit form multiplies
  // the stored tonnes back by 1000, which yields float artefacts (4.001 t →
  // 4001.0000000000005 kg) that the family's `multipleOf(0.001)` guard would
  // reject on an untouched edit. The family's cap is applied here directly,
  // and its gram resolution as an explicit floor: the value is divided by
  // 1000 into a `numeric(14,6)` tonnes column, so a smaller positive entry
  // would persist as zero.
  biocharAppliedTons: z
    .number({ error: "Biochar product applied (kg) is required" })
    .min(MASS_KG_INPUT_STEP, MASS_MIN_KG_MESSAGE)
    .max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE),
  // === Section 2: Field Details ===
  fieldSizeHa: positiveFieldSizeHaSchema,
  fieldIdentifier: z
    .string()
    .max(255, "Field identifier must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  cropType: z
    .string()
    .max(100, "Crop type must be less than 100 characters")
    .optional()
    .or(z.literal("")),
  gpsLatitude: latitudeSchema,
  gpsLongitude: longitudeSchema,
  applicationMethodType: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(applicationMethods).optional().nullable()
  ),
  evidenceMethod: z.enum(applicationEvidenceMethods).default("location"),
  gisBoundary: gisBoundarySchema.nullable().default(null),

  // === Section 3: Soil Temperature ===
  soilTemperatureSource: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(soilTemperatureSources).optional().nullable()
  ),
  soilTemperatureC: z
    .number()
    .min(-50, "Temperature must be at least -50°C")
    .max(60, "Temperature must be at most 60°C")
    .optional()
    .nullable(),

});

export const applicationFormSchema = applicationFormBaseSchema.superRefine(
  (data, ctx) => {
    applicationEvidenceSuperRefine(data, ctx);
  },
);

const applicationCreateBaseSchema = applicationFormBaseSchema.extend({
  biocharAppliedTons: z
    .number({ error: "Biochar product applied is required" })
    .min(MASS_TONNES_INPUT_STEP, MASS_MIN_TONNES_MESSAGE)
    .max(MASS_INPUT_MAX_TONNES, MASS_MAX_TONNES_MESSAGE),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating an application (server action)
 */
export const createApplicationSchema = applicationCreateBaseSchema.superRefine(
  (data, ctx) => {
    applicationEvidenceSuperRefine(data, ctx);
  },
);

/**
 * Schema for updating an application (server action)
 * GPS pair and evidence-method invariants are deferred until updateApplication
 * validates the payload merged with the saved evidence state.
 * Fields stay `.optional()` so a partial patch can omit them, but a value that
 * is present has to clear the same bounds as the create path.
 */
export const updateApplicationSchema = z.object({
  applicationId: z.string().uuid("Choose a valid application."),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  applicationDate: z.coerce.date().optional(),
  deliveryId: z.string().uuid().optional(),
  biocharAppliedTons: z
    .number()
    .min(MASS_TONNES_INPUT_STEP, MASS_MIN_TONNES_MESSAGE)
    .max(MASS_INPUT_MAX_TONNES, MASS_MAX_TONNES_MESSAGE)
    .optional(),
  fieldSizeHa: positiveFieldSizeHaSchema.optional(),
  fieldIdentifier: z.string().max(255).optional().nullable(),
  cropType: z.string().max(100).optional().nullable(),
  gpsLatitude: latitudeSchema,
  gpsLongitude: longitudeSchema,
  applicationMethodType: z.enum(applicationMethods).optional().nullable(),
  evidenceMethod: z.enum(applicationEvidenceMethods).optional(),
  gisBoundary: gisBoundarySchema.optional().nullable(),
  soilTemperatureSource: z.enum(soilTemperatureSources).optional().nullable(),
  soilTemperatureC: z.number().min(-50).max(60).optional().nullable(),
});

/**
 * Schema for deleting an application
 */
export const deleteApplicationSchema = z.object({
  applicationId: z.string().uuid("Choose a valid application."),
});

// ============================================
// Type Inference
// ============================================

export type ApplicationFormData = z.infer<typeof applicationFormSchema>;
export type ApplicationEvidenceState = z.infer<
  typeof applicationEvidenceStateSchema
>;
export type CreateApplicationData = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationData = z.infer<typeof updateApplicationSchema>;
export type DeleteApplicationData = z.infer<typeof deleteApplicationSchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Extended application form schema with GPS validation
 * Both latitude and longitude must be provided together
 */
export const applicationFormSchemaWithGpsValidation = applicationFormSchema;

/**
 * Formatting helpers for display
 */
export function formatSoilTemperatureSource(source: SoilTemperatureSource): string {
  const labels: Record<SoilTemperatureSource, string> = {
    baseline: "Baseline (Direct Measurement)",
    global_database: "Global Database",
  };
  return labels[source];
}

export function formatApplicationMethod(method: ApplicationMethod): string {
  const labels: Record<ApplicationMethod, string> = {
    manual: "Manual",
    mechanical: "Mechanical",
  };
  return labels[method];
}

export function formatApplicationEvidenceMethod(method: ApplicationEvidenceMethod): string {
  const labels: Record<ApplicationEvidenceMethod, string> = {
    location: "Customer location",
    boundary: "GIS reference",
    visual: "Visual evidence",
  };
  return labels[method];
}

export function formatApplicationStatus(status: ApplicationStatus): string {
  const labels: Record<ApplicationStatus, string> = {
    delivered: "Delivered",
    applied: "Applied",
  };
  return labels[status];
}
