import { z } from "zod";
import {
  gpsPairSuperRefine,
  latitudeSchema,
  longitudeSchema,
  MASS_INPUT_MAX_KG,
  MASS_INPUT_MAX_TONNES,
  MASS_MAX_KG_MESSAGE,
  MASS_MAX_TONNES_MESSAGE,
} from "./helpers";
import { gisBoundarySchema } from "./gis-boundary";
import {
  DRY_MASS_EXCEEDS_WET_MESSAGE,
  exceedsMassWithTolerance,
} from "@/lib/calculations/mass-dry";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";

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
 * Application evidence methods (Soil Module §9.5, either visual or boundary).
 */
export const applicationEvidenceMethods = ["visual", "boundary"] as const;
export type ApplicationEvidenceMethod = (typeof applicationEvidenceMethods)[number];

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
 * 1. Application Details — code, applicationDate, delivery, biocharAppliedTons, biocharAppliedDryTons
 * 2. Field Details — fieldSizeHa, fieldIdentifier, cropType, GPS coordinates
 * 3. Soil Temperature — soilTemperatureSource, soilTemperatureC
 */
const applicationFormBaseSchema = z.object({
  // === Section 1: Application Details ===
  applicationDate: z.coerce.date({ error: "Application date is required" }),
  deliveryId: z.string().min(1, "Select a delivery.").uuid("Choose a valid delivery."),
  biocharAppliedTons: z
    .number({ error: "Biochar applied (kg) is required" })
    .min(0, "Must be a positive number")
    .max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE),
  biocharAppliedDryTons: z
    .number()
    .min(0, "Must be a positive number")
    .max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE)
    .optional()
    .nullable(),

  // === Section 2: Field Details ===
  fieldSizeHa: z
    .number()
    .min(0, "Field size must be a positive number")
    .optional()
    .nullable(),
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
  evidenceMethod: z.enum(applicationEvidenceMethods).default("boundary"),
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

type ApplicationMassFields = {
  biocharAppliedTons?: number;
  biocharAppliedDryTons?: number | null;
};

function addDryMassIssue(
  data: ApplicationMassFields,
  ctx: z.RefinementCtx,
  unit: "kg" | "tonnes",
): void {
  if (
    data.biocharAppliedTons == null ||
    data.biocharAppliedDryTons == null
  ) {
    return;
  }
  const wetKg = unit === "tonnes"
    ? tonnesToKg(data.biocharAppliedTons)
    : data.biocharAppliedTons;
  const dryKg = unit === "tonnes"
    ? tonnesToKg(data.biocharAppliedDryTons)
    : data.biocharAppliedDryTons;
  if (!exceedsMassWithTolerance(dryKg, wetKg)) return;

  ctx.addIssue({
    code: "custom",
    path: ["biocharAppliedDryTons"],
    message: DRY_MASS_EXCEEDS_WET_MESSAGE,
  });
}

export const applicationFormSchema = applicationFormBaseSchema.superRefine(
  (data, ctx) => {
    gpsPairSuperRefine(data, ctx);
    addDryMassIssue(data, ctx, "kg");
  },
);

const applicationCreateBaseSchema = applicationFormBaseSchema.extend({
  biocharAppliedTons: z
    .number({ error: "Biochar applied mass is required" })
    .min(0, "Must be a positive number")
    .max(MASS_INPUT_MAX_TONNES, MASS_MAX_TONNES_MESSAGE),
  biocharAppliedDryTons: z
    .number()
    .min(0, "Must be a positive number")
    .max(MASS_INPUT_MAX_TONNES, MASS_MAX_TONNES_MESSAGE)
    .optional()
    .nullable(),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating an application (server action)
 */
export const createApplicationSchema = applicationCreateBaseSchema.superRefine(
  (data, ctx) => {
    gpsPairSuperRefine(data, ctx);
    addDryMassIssue(data, ctx, "tonnes");
  },
);

/**
 * Schema for updating an application (server action)
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
  biocharAppliedTons: z.number().min(0).max(MASS_INPUT_MAX_TONNES, MASS_MAX_TONNES_MESSAGE).optional(),
  biocharAppliedDryTons: z.number().min(0).max(MASS_INPUT_MAX_TONNES, MASS_MAX_TONNES_MESSAGE).optional().nullable(),
  fieldSizeHa: z.number().min(0).optional().nullable(),
  fieldIdentifier: z.string().max(255).optional().nullable(),
  cropType: z.string().max(100).optional().nullable(),
  gpsLatitude: latitudeSchema,
  gpsLongitude: longitudeSchema,
  applicationMethodType: z.enum(applicationMethods).optional().nullable(),
  evidenceMethod: z.enum(applicationEvidenceMethods).optional(),
  gisBoundary: gisBoundarySchema.optional().nullable(),
  soilTemperatureSource: z.enum(soilTemperatureSources).optional().nullable(),
  soilTemperatureC: z.number().min(-50).max(60).optional().nullable(),
}).superRefine((data, ctx) => {
  gpsPairSuperRefine(data, ctx);
  addDryMassIssue(data, ctx, "tonnes");
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
    visual: "Visual evidence",
    boundary: "GIS reference",
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
