/**
 * Shared Zod helpers for schema validation
 */

import { z } from "zod";

/**
 * Zod literal that matches "" and transforms it to null.
 * Use with .or() on optional/nullable UUID fields to handle
 * EntitySelect clearing (which sends "" instead of null).
 *
 * Example: z.string().uuid().nullable().or(emptyToNull)
 */
export const emptyToNull = z.literal("").transform((): null => null);

// ============================================
// GPS Coordinate Schemas
// ============================================

/**
 * GPS latitude validation (-90 to 90)
 */
export const latitudeSchema = z
  .number()
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90")
  .optional()
  .nullable();

/**
 * GPS longitude validation (-180 to 180)
 */
export const longitudeSchema = z
  .number()
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180")
  .optional()
  .nullable();

export const requiredLatitudeSchema = z
  .number({ error: (iss) => iss.input === undefined ? "Latitude is required" : "Expected number" })
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

export const requiredLongitudeSchema = z
  .number({ error: (iss) => iss.input === undefined ? "Longitude is required" : "Expected number" })
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

/**
 * Combined GPS coordinates schema
 */
export const gpsCoordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export type GpsCoordinates = z.infer<typeof gpsCoordinatesSchema>;

export const GPS_PAIR_MESSAGE =
  "Both latitude and longitude must be provided together";

export function hasCompleteGpsPair(data: {
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
}): boolean {
  const hasLat = data.gpsLatitude != null;
  const hasLng = data.gpsLongitude != null;
  return hasLat === hasLng;
}

// ============================================
// Zod Preprocessors for Form String → Number Coercion
// ============================================

/** Preprocess form string values to number | undefined. Empty/null/whitespace strings become undefined (pair with Zod 4's unified `error` parameter for custom required messages). */
export const toNumberOrUndefined = (v: unknown): unknown => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return undefined;
    return Number(trimmed);
  }
  return v;
};

/** Preprocess form string values to number | null. Empty/whitespace strings become null. */
export const toNumberOrNull = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    return Number(trimmed);
  }
  return v;
};

/** Optional numeric field: preprocess form string → number | null, then validate as finite number. */
export const optionalNumber = z.preprocess(
  toNumberOrNull,
  z.number().finite().nullable().optional()
);

/** Optional non-negative numeric field: preprocess form string → number | null, then validate >= 0. */
export const optionalPositiveNumber = z.preprocess(
  toNumberOrNull,
  z.number().finite().min(0, "Must be a non-negative number").nullable().optional()
);

/**
 * Required numeric field: preprocess form strings to number | undefined, then
 * surface a friendly required/invalid message instead of Zod's raw type error.
 */
export function requiredNumber(
  requiredMessage = "Required",
  invalidMessage = "Invalid number",
) {
  return z.preprocess(
    toNumberOrUndefined,
    z
      .number({
        error: (iss) =>
          iss.input === undefined ? requiredMessage : invalidMessage,
      })
      .finite(invalidMessage),
  );
}

/** Optional percent field: preprocess form string → number | null, then validate 0–100 range. */
export const optionalPercent = z.preprocess(
  toNumberOrNull,
  z
    .number()
    .min(0, "Must be 0–100")
    .max(100, "Must be 0–100")
    .nullable()
    .optional()
);

/** Plausible soil-temperature range for biochar application sites (°C). */
export const SOIL_TEMPERATURE_MIN_C = -50;
export const SOIL_TEMPERATURE_MAX_C = 60;

const SOIL_TEMPERATURE_RANGE_MESSAGE = `Soil temperature must be between ${SOIL_TEMPERATURE_MIN_C} and ${SOIL_TEMPERATURE_MAX_C} °C`;

/**
 * Optional default-soil-temperature field (°C), shared by customer-location
 * and facility-emission-config forms so empty/whitespace inputs normalize
 * identically (to null) on both surfaces.
 */
export const defaultSoilTemperatureSchema = optionalNumber.pipe(
  z
    .number()
    .min(SOIL_TEMPERATURE_MIN_C, SOIL_TEMPERATURE_RANGE_MESSAGE)
    .max(SOIL_TEMPERATURE_MAX_C, SOIL_TEMPERATURE_RANGE_MESSAGE)
    .nullable()
    .optional(),
);

// ============================================
// Date-Only Input Helpers
// ============================================

/**
 * Required date field fed by `<input type="date">` ("YYYY-MM-DD").
 *
 * Parses date-only strings at LOCAL midnight for the same reason as
 * optionalDateOnly below: the field represents a calendar day, not an instant.
 */
export const requiredDateOnly = z.union([
  z.date(),
  z.string().min(1, "Required").transform((val, ctx): Date => {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(val);
    if (isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return date;
  }),
]);

/**
 * Optional date field fed by `<input type="date">` ("YYYY-MM-DD").
 *
 * Parses date-only strings at LOCAL midnight — `new Date("YYYY-MM-DD")`
 * parses as UTC midnight, which renders as the previous day in timezones
 * west of UTC and shifts the stored date back one day on every edit/save
 * round-trip. Empty or invalid input becomes undefined; Date values (e.g.
 * server-side re-validation of an already-transformed payload) pass through.
 */
export const optionalDateOnly = z
  .union([
    z.date(),
    z.string().transform((val): Date | undefined => {
      if (val === "") return undefined;
      const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
      const date = dateOnly
        ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
        : new Date(val);
      return isNaN(date.getTime()) ? undefined : date;
    }),
  ])
  .optional();

/** Preprocess form string values to int | null. Empty/whitespace strings become null. Rejects partial parses like "12abc". */
export const toIntOrNull = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const num = Number(trimmed);
    if (Number.isNaN(num) || !Number.isInteger(num)) return trimmed;
    return num;
  }
  return v;
};
