import { z } from "zod";
import {
  gpsPairSuperRefine,
  latitudeSchema,
  longitudeSchema,
  MASS_INPUT_MAX_KG,
  MASS_KG_INPUT_STEP,
  MASS_KG_PRECISION_MESSAGE,
  MASS_MAX_KG_MESSAGE,
  MASS_MIN_KG_MESSAGE,
  calendarDateSchema,
  requiredNumber,
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

/** Methods offered for new operator selections. `visual` remains for legacy records. */
export const selectableApplicationEvidenceMethods = [
  "location",
  "boundary",
] as const satisfies readonly ApplicationEvidenceMethod[];

export function isSelectableApplicationEvidenceMethod(
  value: ApplicationEvidenceMethod,
): value is (typeof selectableApplicationEvidenceMethods)[number] {
  return selectableApplicationEvidenceMethods.includes(
    value as (typeof selectableApplicationEvidenceMethods)[number],
  );
}

const CUSTOMER_LOCATION_REQUIRED_MESSAGE =
  "Customer location coordinates are required.";
const positiveFieldSizeHaSchema = requiredNumber(
  FIELD_SIZE_REQUIRED_MESSAGE,
  "Enter a valid field size",
)
  .refine(isPositiveApplicationFieldSize, FIELD_SIZE_POSITIVE_MESSAGE);

function applicationEvidenceSuperRefine(
  data: {
    evidenceMethod?: ApplicationEvidenceMethod;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    gisBoundary?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  gpsPairSuperRefine(data, ctx);
  if (data.evidenceMethod === "boundary" && !data.gisBoundary) {
    ctx.addIssue({ code: "custom", path: ["gisBoundary"], message: "Add a boundary file, or choose Customer location." });
  }
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
    gisBoundary: gisBoundarySchema.nullable().optional(),
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
  applicationDate: calendarDateSchema("Application date is required"),
  deliveryId: z.string().min(1, "Select a delivery.").uuid("Choose a valid delivery."),
  // The form and operation take kg. Only the transaction writer stores tonnes.
  biocharAppliedKg: z
    .number({ error: "Biochar product applied (kg) is required" })
    .min(MASS_KG_INPUT_STEP, MASS_MIN_KG_MESSAGE)
    .max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE)
    .multipleOf(MASS_KG_INPUT_STEP, MASS_KG_PRECISION_MESSAGE),
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

// ============================================
// Type Inference
// ============================================

export type ApplicationFormData = z.infer<typeof applicationFormSchema>;
export type ApplicationEvidenceState = z.infer<
  typeof applicationEvidenceStateSchema
>;

// ============================================
// Validation Helpers
// ============================================

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

/** One-line consequence of each evidence method, shared by every card that offers the choice. */
export const APPLICATION_EVIDENCE_METHOD_DESCRIPTIONS: Record<
  ApplicationEvidenceMethod,
  string
> = {
  location:
    "Use the application GPS coordinates from the delivery's customer location.",
  boundary: "The field boundary as a GeoJSON file, drawn on a map.",
  visual: "Geotagged photos of each application stage.",
};

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
