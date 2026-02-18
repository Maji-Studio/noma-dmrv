/**
 * Customer Validation Schemas
 * Zod schemas for customer and customer location forms, server actions, and filtering
 */

import { z } from "zod";

// ============================================
// GPS Coordinate Validation (Required for customer locations)
// ============================================

/**
 * GPS latitude validation (-90 to 90) - Required for customer locations
 */
const requiredLatitudeSchema = z
  .number()
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

/**
 * GPS longitude validation (-180 to 180) - Required for customer locations
 */
const requiredLongitudeSchema = z
  .number()
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

// ============================================
// Customer Form Schema (Client-side validation)
// ============================================

/**
 * Schema for customer form (client-side validation)
 * Used in CustomerForm component for creating/editing customers
 */
export const customerFormSchema = z.object({
  // Required fields
  code: z
    .string()
    .max(50, "Customer code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Customer code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  name: z
    .string()
    .min(1, "Customer name is required")
    .max(255, "Customer name must be less than 255 characters"),

  // Optional fields
  cropType: z
    .string()
    .max(100, "Crop type must be less than 100 characters")
    .optional()
    .or(z.literal("")),
  address: z
    .string()
    .max(500, "Address must be less than 500 characters")
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
});

// ============================================
// Customer Location Form Schema
// ============================================

/**
 * Schema for customer location form (client-side validation)
 * Used in CustomerLocationForm component for creating/editing locations
 */
export const customerLocationFormSchema = z.object({
  // Required fields
  name: z
    .string()
    .min(1, "Location name is required")
    .max(255, "Location name must be less than 255 characters"),
  gpsLatitude: requiredLatitudeSchema,
  gpsLongitude: requiredLongitudeSchema,

  // Optional fields
  address: z
    .string()
    .max(500, "Address must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas - Customer
// ============================================

/**
 * Schema for creating a customer (server action)
 * Same as form schema - all required fields must be present
 */
export const createCustomerSchema = customerFormSchema;

/**
 * Schema for updating a customer (server action)
 * All fields optional except customerId
 */
export const updateCustomerSchema = z.object({
  customerId: z.string().uuid("Invalid customer ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  name: z.string().min(1).max(255).optional(),
  cropType: z.string().max(100).optional().nullable().or(z.literal("")),
  address: z.string().max(500).optional().nullable().or(z.literal("")),
  contactEmail: z.string().email().max(255).optional().nullable().or(z.literal("")),
  contactPhone: z.string().max(30).optional().nullable().or(z.literal("")),
});

/**
 * Schema for deleting a customer
 */
export const deleteCustomerSchema = z.object({
  customerId: z.string().uuid("Invalid customer ID"),
});

// ============================================
// Server Action Schemas - Customer Location
// ============================================

/**
 * Schema for creating a customer location (server action)
 */
export const createCustomerLocationSchema = z.object({
  customerId: z.string().uuid("Invalid customer ID"),
  name: z
    .string()
    .min(1, "Location name is required")
    .max(255, "Location name must be less than 255 characters"),
  gpsLatitude: requiredLatitudeSchema,
  gpsLongitude: requiredLongitudeSchema,
  address: z
    .string()
    .max(500, "Address must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

/**
 * Schema for updating a customer location (server action)
 */
export const updateCustomerLocationSchema = z.object({
  locationId: z.string().uuid("Invalid location ID"),
  name: z.string().min(1).max(255).optional(),
  gpsLatitude: requiredLatitudeSchema.optional(),
  gpsLongitude: requiredLongitudeSchema.optional(),
  address: z.string().max(500).optional().nullable().or(z.literal("")),
});

/**
 * Schema for deleting a customer location
 */
export const deleteCustomerLocationSchema = z.object({
  locationId: z.string().uuid("Invalid location ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering customers in list views
 * Used for search, pagination, and filtering
 */
export const customerFilterSchema = z.object({
  // Text search across code, name, cropType
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by crop type
  cropType: z.string().max(100).optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "name", "cropType", "createdAt", "updatedAt"])
    .default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Schema for selecting a customer (e.g., in dropdowns)
 */
export const customerSelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  cropType: z.string().optional().nullable(),
});

// ============================================
// Type Inference
// ============================================

export type CustomerFormData = z.infer<typeof customerFormSchema>;
export type CustomerLocationFormData = z.infer<typeof customerLocationFormSchema>;
export type CreateCustomerData = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerData = z.infer<typeof updateCustomerSchema>;
export type DeleteCustomerData = z.infer<typeof deleteCustomerSchema>;
export type CreateCustomerLocationData = z.infer<typeof createCustomerLocationSchema>;
export type UpdateCustomerLocationData = z.infer<typeof updateCustomerLocationSchema>;
export type DeleteCustomerLocationData = z.infer<typeof deleteCustomerLocationSchema>;
export type CustomerFilterData = z.infer<typeof customerFilterSchema>;
export type CustomerSelectData = z.infer<typeof customerSelectSchema>;
