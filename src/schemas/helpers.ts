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

/**
 * Combined GPS coordinates schema
 */
export const gpsCoordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export type GpsCoordinates = z.infer<typeof gpsCoordinatesSchema>;

// ============================================
// Zod Preprocessors for Form String → Number Coercion
// ============================================

/** Preprocess form string values to number | null. Empty strings become null. */
export const toNumberOrNull = (v: unknown): number | null | unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v === "" ? null : Number(v);
  return v;
};

/** Preprocess form string values to int | null. Empty strings become null. */
export const toIntOrNull = (v: unknown): number | null | unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v === "" ? null : parseInt(v, 10);
  return v;
};
