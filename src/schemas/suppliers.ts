/**
 * Supplier Validation Schemas
 * Zod schemas for supplier forms, server actions, and filtering
 */

import { z } from "zod";

// ============================================
// GPS Coordinate Validation (Optional for suppliers)
// ============================================

/**
 * GPS latitude validation (-90 to 90) - Optional for suppliers
 */
const optionalLatitudeSchema = z
  .number()
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90")
  .optional()
  .nullable();

/**
 * GPS longitude validation (-180 to 180) - Optional for suppliers
 */
const optionalLongitudeSchema = z
  .number()
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180")
  .optional()
  .nullable();

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
    .min(1, "Supplier name is required")
    .max(255, "Supplier name must be less than 255 characters"),

  // Location fields
  location: z
    .string()
    .max(255, "Location must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  gpsLatitude: z.union([
    z.number().min(-90).max(90),
    z.string().transform((val) => {
      if (val === "") return null;
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    }),
    z.null(),
  ]).optional().nullable(),
  gpsLongitude: z.union([
    z.number().min(-180).max(180),
    z.string().transform((val) => {
      if (val === "") return null;
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    }),
    z.null(),
  ]).optional().nullable(),
  address: z
    .string()
    .max(500, "Address must be less than 500 characters")
    .optional()
    .or(z.literal("")),

  // Contact Information
  contactName: z
    .string()
    .max(255, "Contact name must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  contactEmail: z
    .string()
    .email("Please enter a valid email address")
    .max(255, "Email must be less than 255 characters")
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
    .max(255, "Source region must be less than 255 characters")
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
  supplierId: z.string().uuid("Invalid supplier ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  name: z.string().min(1).max(255).optional(),
  location: z.string().max(255).optional().nullable().or(z.literal("")),
  gpsLatitude: optionalLatitudeSchema,
  gpsLongitude: optionalLongitudeSchema,
  address: z.string().max(500).optional().nullable().or(z.literal("")),
  contactName: z.string().max(255).optional().nullable().or(z.literal("")),
  contactEmail: z.string().email().max(255).optional().nullable().or(z.literal("")),
  contactPhone: z.string().max(30).optional().nullable().or(z.literal("")),
  sourceRegion: z.string().max(255).optional().nullable().or(z.literal("")),
});

/**
 * Schema for deleting a supplier
 */
export const deleteSupplierSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering suppliers in list views
 * Used for search, pagination, and filtering
 */
export const supplierFilterSchema = z.object({
  // Text search across code, name, location
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by location
  location: z.string().max(255).optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "name", "location", "createdAt", "updatedAt"])
    .default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Schema for selecting a supplier (e.g., in dropdowns)
 */
export const supplierSelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  location: z.string().optional().nullable(),
});

// ============================================
// Type Inference
// ============================================

export type SupplierFormData = z.infer<typeof supplierFormSchema>;
export type CreateSupplierData = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierData = z.infer<typeof updateSupplierSchema>;
export type DeleteSupplierData = z.infer<typeof deleteSupplierSchema>;
export type SupplierFilterData = z.infer<typeof supplierFilterSchema>;
export type SupplierSelectData = z.infer<typeof supplierSelectSchema>;
