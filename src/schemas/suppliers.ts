/**
 * Supplier Validation Schemas
 * Zod schemas for supplier forms, server actions, and filtering
 */

import { z } from "zod";
import { PARTY_MAX_LOCATIONS, PARTY_NAME_MAX, LOCATION_PLACE_MAX, PARTY_ADDRESS_MAX } from "@/config/party-input";
import { facilityDistancesInputSchema } from "./facility-distances";
import {
  expectedVersionSchema,
  gpsPairSuperRefine,
  requiredLatitudeSchema,
  requiredLongitudeSchema,
  toNumberOrUndefined,
} from "./helpers";

// ============================================
// Supplier Form Schema (Client-side validation)
// ============================================

/**
 * Schema for supplier form (client-side validation)
 * Used in SupplierForm component for creating/editing suppliers
 */
export const supplierFormSchema = z.object({
  // Required fields
  name: z
    .string()
    .trim()
    .min(1, "Supplier name is required")
    .max(PARTY_NAME_MAX, "Supplier name must be less than 255 characters"),

  // Location fields
  // General region text only — precise coordinates/distance live per-location
  // in supplierLocations (mirrors customers).
  location: z
    .string()
    .max(PARTY_NAME_MAX, "Location must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  address: z
    .string()
    .max(PARTY_ADDRESS_MAX, "Address must be less than 500 characters")
    .optional()
    .or(z.literal("")),

  // Contact Information
  contactName: z
    .string()
    .max(PARTY_NAME_MAX, "Contact name must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  contactEmail: z
    .string()
    .email("Enter a valid email address.")
    .max(PARTY_NAME_MAX, "Email must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  contactPhone: z
    .string()
    .max(30, "Phone number must be less than 30 characters")
    .optional()
    .or(z.literal("")),

  // Sourcing
  sourceRegion: z
    .string()
    .max(PARTY_NAME_MAX, "Source region must be less than 255 characters")
    .optional()
    .or(z.literal("")),

});

// ============================================
// Server Action Schemas - Supplier
// ============================================

/**
 * Schema for creating a supplier (server action)
 * Same as form schema - all required fields must be present
 */
export const createSupplierSchema = supplierFormSchema;

/**
 * Schema for updating a supplier (server action)
 * All fields optional except supplierId
 */
export const updateSupplierSchema = z.object({
  supplierId: z.string().uuid("Choose a valid supplier."),
  expectedVersion: expectedVersionSchema,
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  name: z.string().trim().min(1).max(PARTY_NAME_MAX).optional(),
  location: z.string().max(PARTY_NAME_MAX).optional().nullable().or(z.literal("")),
  address: z.string().max(PARTY_ADDRESS_MAX).optional().nullable().or(z.literal("")),
  contactName: z.string().max(PARTY_NAME_MAX).optional().nullable().or(z.literal("")),
  contactEmail: z.string().email().max(PARTY_NAME_MAX).optional().nullable().or(z.literal("")),
  contactPhone: z.string().max(30).optional().nullable().or(z.literal("")),
  sourceRegion: z.string().max(PARTY_NAME_MAX).optional().nullable().or(z.literal("")),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering suppliers in list views
 * Used for search, pagination, and filtering
 */
export const supplierFilterSchema = z.object({
  // false = active only; true = archived only.
  archived: z.boolean().default(false),
  // Text search across code, name, location
  search: z
    .string()
    .max(PARTY_NAME_MAX, "Search query must be less than 255 characters")
    .optional(),

  // Filter by location
  location: z.string().max(PARTY_NAME_MAX).optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "name", "location", "createdAt", "updatedAt"])
    .default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// ============================================
// Supplier Location Schemas
// ============================================

/**
 * Schema for supplier location form (client-side validation)
 */
export const supplierLocationFormSchema = z.object({
  name: z.string().max(PARTY_NAME_MAX, "Name must be less than 255 characters").optional().or(z.literal("")),
  country: z.string().min(1, "Country is required").max(LOCATION_PLACE_MAX, "Country must be less than 100 characters"),
  stateRegion: z.string().max(LOCATION_PLACE_MAX, "State/Region must be less than 100 characters").optional().or(z.literal("")),
  city: z.string().max(LOCATION_PLACE_MAX, "City must be less than 100 characters").optional().or(z.literal("")),
  gpsLatitude: z.preprocess(toNumberOrUndefined, requiredLatitudeSchema),
  gpsLongitude: z.preprocess(toNumberOrUndefined, requiredLongitudeSchema),
  address: z.string().max(PARTY_ADDRESS_MAX, "Address must be less than 500 characters").optional().or(z.literal("")),
  // Road distance (km) from this location to the delivery facility.
  facilityDistances: facilityDistancesInputSchema,
  // Marks this as the supplier's default source location.
  isDefault: z.boolean().optional().default(false),
});

export const supplierQuickAddSchema = supplierFormSchema
  .pick({ name: true })
  .extend(
    supplierLocationFormSchema.pick({
      country: true,
      facilityDistances: true,
      gpsLatitude: true,
      gpsLongitude: true,
    }).shape,
  )
  .superRefine(gpsPairSuperRefine);

/**
 * Schema for creating a supplier location (server action)
 */
export const createSupplierLocationSchema = supplierLocationFormSchema.extend({
  supplierId: z.string().uuid("Choose a valid supplier."),
});

export const createSupplierWithLocationsSchema = z.object({
  supplier: createSupplierSchema,
  locations: z
    .array(supplierLocationFormSchema)
    .max(PARTY_MAX_LOCATIONS)
    .min(1, "At least one location is required"),
});

/**
 * Schema for updating a supplier location (server action)
 */
export const updateSupplierLocationSchema = z.object({
  locationId: z.string().uuid("Choose a valid location."),
  expectedVersion: expectedVersionSchema,
  name: z.string().max(PARTY_NAME_MAX).optional().nullable().or(z.literal("")),
  country: z.string().min(1).max(LOCATION_PLACE_MAX).optional(),
  stateRegion: z.string().max(LOCATION_PLACE_MAX).optional().nullable().or(z.literal("")),
  city: z.string().max(LOCATION_PLACE_MAX).optional().nullable().or(z.literal("")),
  gpsLatitude: requiredLatitudeSchema.optional(),
  gpsLongitude: requiredLongitudeSchema.optional(),
  address: z.string().max(PARTY_ADDRESS_MAX).optional().nullable().or(z.literal("")),
  facilityDistances: facilityDistancesInputSchema,
  isDefault: z.boolean().optional(),
}).superRefine(gpsPairSuperRefine);

/**
 * Schema for deleting a supplier location
 */
export const deleteSupplierLocationSchema = z.object({
  expectedVersion: expectedVersionSchema,
  locationId: z.string().uuid("Choose a valid location."),
});

// ============================================
// Type Inference
// ============================================

export type SupplierFormData = z.infer<typeof supplierFormSchema>;
export type CreateSupplierData = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierData = z.infer<typeof updateSupplierSchema>;
export type SupplierFilterData = z.infer<typeof supplierFilterSchema>;
export type SupplierLocationFormData = z.infer<typeof supplierLocationFormSchema>;
export type SupplierQuickAddData = z.infer<typeof supplierQuickAddSchema>;
export type SupplierQuickAddInput = z.input<typeof supplierQuickAddSchema>;
export type CreateSupplierLocationData = z.infer<typeof createSupplierLocationSchema>;
export type CreateSupplierWithLocationsData = z.infer<
  typeof createSupplierWithLocationsSchema
>;
export type UpdateSupplierLocationData = z.infer<typeof updateSupplierLocationSchema>;
