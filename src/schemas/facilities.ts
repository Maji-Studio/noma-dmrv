import { z } from "zod";
import {
  gpsPairSuperRefine,
  latitudeSchema,
  longitudeSchema,
} from "./helpers";

// ============================================
// Constants and Enums
// ============================================

/**
 * Durability options from the Isometric Protocol
 */
export const durabilityOptions = ["200_year", "1000_year"] as const;

export type DurabilityOption = (typeof durabilityOptions)[number];

/**
 * Common timezone identifiers (IANA timezone database)
 * Subset of most commonly used timezones for biochar facilities
 */
export const timezones = [
  // Africa
  "Africa/Nairobi",
  "Africa/Dar_es_Salaam",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Africa/Casablanca",
  // Americas
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "America/Mexico_City",
  // Asia
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Jakarta",
  // Europe
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "Europe/Stockholm",
  // Oceania
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  // UTC
  "UTC",
] as const;

export type Timezone = (typeof timezones)[number];

// ============================================
// Address Validation Schema
// ============================================

/**
 * Schema for address fields with validation
 * Supports structured address data with country validation
 */
export const addressSchema = z.object({
  streetAddress: z
    .string()
    .max(255, "Street address must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  city: z
    .string()
    .max(100, "City must be less than 100 characters")
    .optional()
    .or(z.literal("")),
  state: z
    .string()
    .max(100, "State/Province must be less than 100 characters")
    .optional()
    .or(z.literal("")),
  postalCode: z
    .string()
    .max(20, "Postal code must be less than 20 characters")
    .optional()
    .or(z.literal("")),
  country: z
    .string()
    .min(1, "Country is required")
    .max(100, "Country must be less than 100 characters"),
});

/**
 * Simplified address schema for facilities table
 * Maps to the single address field in the database
 */
export const facilityAddressSchema = z
  .string()
  .max(500, "Address must be less than 500 characters")
  .optional()
  .or(z.literal(""));

// ============================================
// GPS Coordinate Validation
// ============================================

// GPS schemas imported from ./helpers

// ============================================
// Contact Information Validation
// ============================================

/**
 * Email validation for facility contact
 */
export const contactEmailSchema = z
  .string()
  .email("Please enter a valid email address")
  .max(255, "Email must be less than 255 characters")
  .optional()
  .or(z.literal(""));

/**
 * Phone validation for facility contact
 * Supports international phone formats
 */
export const contactPhoneSchema = z
  .string()
  .regex(
    /^(\+?[1-9]\d{0,3}[-.\s]?)?(\(?\d{1,4}\)?[-.\s]?)?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/,
    "Please enter a valid phone number"
  )
  .max(30, "Phone number must be less than 30 characters")
  .optional()
  .or(z.literal(""));

// ============================================
// Facility Form Schema (Client-side validation)
// ============================================

/**
 * Schema for facility form (client-side validation)
 * Used in FacilityForm component for creating/editing facilities
 */
const facilityFormBaseSchema = z.object({
  // Required fields
  name: z
    .string()
    .min(1, "Facility name is required")
    .max(255, "Facility name must be less than 255 characters"),
  country: z
    .string()
    .min(1, "Country is required")
    .max(100, "Country must be less than 100 characters"),

  // Optional fields
  location: z
    .string()
    .max(255, "Location must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  address: facilityAddressSchema,
  gpsLatitude: latitudeSchema,
  gpsLongitude: longitudeSchema,
  contactEmail: contactEmailSchema,
  contactPhone: contactPhoneSchema,
  // Authoritative durability tier for the facility (ADR 0021) — inherited by
  // its credit batches and samples. 1000-year is the go-forward default.
  durabilityOption: z.enum(durabilityOptions).default("1000_year"),
  timezone: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(timezones, { message: "Timezone is required" })
  ),
});

export const facilityFormSchema =
  facilityFormBaseSchema.superRefine(gpsPairSuperRefine);

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a facility (server action)
 * Same as form schema - all required fields must be present
 */
export const createFacilitySchema = facilityFormSchema;

/**
 * Schema for updating a facility (server action)
 * All fields optional except facilityId
 */
export const updateFacilitySchema = z.object({
  facilityId: z.string().uuid("Invalid facility ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  name: z.string().min(1).max(255).optional(),
  country: z.string().min(1).max(100).optional(),
  location: z.string().max(255).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  gpsLatitude: latitudeSchema,
  gpsLongitude: longitudeSchema,
  contactEmail: z.string().email().max(255).optional().nullable().or(z.literal("")),
  contactPhone: z.string().max(30).optional().nullable().or(z.literal("")),
  durabilityOption: z.enum(durabilityOptions).optional(),
  timezone: z.enum(timezones).optional(),
}).superRefine(gpsPairSuperRefine);

/**
 * Schema for archiving a facility (soft delete, cascades to child data)
 */
export const archiveFacilitySchema = z.object({
  facilityId: z.string().uuid("Invalid facility ID"),
});

/**
 * Schema for restoring an archived facility
 */
export const restoreFacilitySchema = archiveFacilitySchema;

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering facilities in list views
 * Used for search, pagination, and filtering
 */
export const facilityFilterSchema = z.object({
  // Text search across code, name, location
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by country
  country: z.string().max(100).optional(),

  // false (default) = active facilities only; true = archived facilities only
  archived: z.boolean().default(false),

  // Filter by durability option
  durabilityOption: z.enum(durabilityOptions).optional(),

  // Filter by timezone
  timezone: z.enum(timezones).optional(),

  // GPS bounding box for geographic filtering
  bounds: z
    .object({
      north: z.number().min(-90).max(90),
      south: z.number().min(-90).max(90),
      east: z.number().min(-180).max(180),
      west: z.number().min(-180).max(180),
    })
    .optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "name", "country", "location", "createdAt", "updatedAt"])
    .default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Schema for selecting a facility (e.g., in dropdowns)
 */
export const facilitySelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  location: z.string().optional().nullable(),
  country: z.string(),
});

// ============================================
// Type Inference
// ============================================

export type AddressData = z.infer<typeof addressSchema>;
export type { GpsCoordinates } from "./helpers";
export type FacilityFormData = z.infer<typeof facilityFormSchema>;
export type CreateFacilityData = z.infer<typeof createFacilitySchema>;
export type UpdateFacilityData = z.infer<typeof updateFacilitySchema>;
export type ArchiveFacilityData = z.infer<typeof archiveFacilitySchema>;
export type FacilityFilterData = z.infer<typeof facilityFilterSchema>;
export type FacilitySelectData = z.infer<typeof facilitySelectSchema>;

/**
 * Quick-add facility schema for inline facility creation
 * Minimal required fields for rapid data entry
 */
export const quickAddFacilitySchema = z.object({
  name: z.string().min(1, "Facility name is required").max(255),
  country: z.string().min(1, "Country is required").max(100),
  location: z.string().max(255).optional().or(z.literal("")),
});

export type QuickAddFacilityData = z.infer<typeof quickAddFacilitySchema>;
