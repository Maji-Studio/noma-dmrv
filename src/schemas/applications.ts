import { z } from "zod";
import { emptyToNull, latitudeSchema, longitudeSchema } from "./helpers";

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
 * 4. Truck Weighing — truckMassOnArrivalKg, truckMassOnDepartureKg
 */
export const applicationFormSchema = z.object({
  // === Section 1: Application Details ===
  applicationDate: z.coerce.date({ error: "Application date is required" }),
  deliveryId: z.string().min(1, "Please select a delivery").uuid("Invalid delivery"),
  biocharAppliedTons: z
    .number({ error: "Biochar applied (tons) is required" })
    .min(0, "Must be a positive number"),
  biocharAppliedDryTons: z
    .number({ error: "Biochar applied dry (tons) is required" })
    .min(0, "Must be a positive number"),

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
  gisBoundaryReference: z
    .string()
    .max(255, "GIS boundary reference must be less than 255 characters")
    .optional()
    .or(z.literal("")),

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

  // === Section 4: Truck Weighing ===
  truckMassOnArrivalKg: z
    .number()
    .min(0, "Mass must be a positive number")
    .optional()
    .nullable(),
  truckMassOnDepartureKg: z
    .number()
    .min(0, "Mass must be a positive number")
    .optional()
    .nullable(),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating an application (server action)
 */
export const createApplicationSchema = applicationFormSchema;

/**
 * Schema for updating an application (server action)
 */
export const updateApplicationSchema = z.object({
  applicationId: z.string().uuid("Invalid application ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  applicationDate: z.coerce.date().optional(),
  deliveryId: z.string().uuid().optional(),
  biocharAppliedTons: z.number().min(0).optional(),
  biocharAppliedDryTons: z.number().min(0).optional(),
  fieldSizeHa: z.number().min(0).optional().nullable(),
  fieldIdentifier: z.string().max(255).optional().nullable(),
  cropType: z.string().max(100).optional().nullable(),
  gpsLatitude: latitudeSchema,
  gpsLongitude: longitudeSchema,
  applicationMethodType: z.enum(applicationMethods).optional().nullable(),
  gisBoundaryReference: z.string().max(255).optional().nullable(),
  soilTemperatureSource: z.enum(soilTemperatureSources).optional().nullable(),
  soilTemperatureC: z.number().min(-50).max(60).optional().nullable(),
  truckMassOnArrivalKg: z.number().min(0).optional().nullable(),
  truckMassOnDepartureKg: z.number().min(0).optional().nullable(),
  status: z.enum(applicationStatuses).optional(),
});

/**
 * Schema for deleting an application
 */
export const deleteApplicationSchema = z.object({
  applicationId: z.string().uuid("Invalid application ID"),
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
export const applicationFormSchemaWithGpsValidation = applicationFormSchema.refine(
  (data) => {
    const hasLat = data.gpsLatitude != null;
    const hasLng = data.gpsLongitude != null;
    return hasLat === hasLng;
  },
  {
    message: "Both latitude and longitude must be provided together",
    path: ["gpsLatitude"],
  }
);

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

export function formatApplicationStatus(status: ApplicationStatus): string {
  const labels: Record<ApplicationStatus, string> = {
    delivered: "Delivered",
    applied: "Applied",
  };
  return labels[status];
}
