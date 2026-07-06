/**
 * Customer Validation Schemas
 * Zod schemas for customer and customer location forms, server actions, and filtering
 */

import { z } from "zod";
import { optionalDistanceSource } from "./distance-source";
import {
  defaultSoilTemperatureSchema,
  optionalPositiveNumber,
  requiredLatitudeSchema as requiredLat,
  requiredLongitudeSchema as requiredLng,
  toNumberOrUndefined,
} from "./helpers";

// ============================================
// Shared Location Part Schemas
// ============================================

const LOCATION_PART_MAX = 100;
const locationPartSchema = z.string().max(LOCATION_PART_MAX).optional().nullable().or(z.literal(""));

// ============================================
// GPS Coordinate Validation
// ============================================

const optionalLatitudeSchema = requiredLat.nullable().optional();
const optionalLongitudeSchema = requiredLng.nullable().optional();
const customerLocationTextSchema = z
  .string()
  .min(1, "Address / description is required")
  .max(500, "Address / description must be less than 500 characters");
// ============================================
// Customer Form Schema (Client-side validation)
// ============================================

/**
 * Schema for customer form (client-side validation)
 * Used in CustomerForm component for creating/editing customers
 */
export const customerFormSchema = z.object({
  // Required fields
  name: z
    .string()
    .trim()
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
    .trim()
    .min(1, "Location name is required")
    .max(255, "Location name must be less than 255 characters"),
  country: z.string().min(1, "Country is required").max(100, "Country must be less than 100 characters"),
  stateRegion: locationPartSchema,
  city: locationPartSchema,
  address: customerLocationTextSchema,
  gpsLatitude: z.preprocess(toNumberOrUndefined, requiredLat),
  gpsLongitude: z.preprocess(toNumberOrUndefined, requiredLng),
  // Operational road distance (km) from the origin facility. Certifier
  // transport is recorded on cargo entities, not deliveries.
  distanceFromFacilityKm: optionalPositiveNumber,
  distanceSource: optionalDistanceSource,
  defaultSoilTemperatureC: defaultSoilTemperatureSchema,
  // Marks this as the customer's default destination.
  isDefault: z.boolean().optional().default(false),
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
  name: z.string().trim().min(1).max(255).optional(),
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
    .trim()
    .min(1, "Location name is required")
    .max(255, "Location name must be less than 255 characters"),
  country: z.string().min(1, "Country is required").max(LOCATION_PART_MAX),
  stateRegion: locationPartSchema,
  city: locationPartSchema,
  address: customerLocationTextSchema,
  gpsLatitude: z.preprocess(toNumberOrUndefined, requiredLat),
  gpsLongitude: z.preprocess(toNumberOrUndefined, requiredLng),
  distanceFromFacilityKm: optionalPositiveNumber,
  distanceSource: optionalDistanceSource,
  defaultSoilTemperatureC: defaultSoilTemperatureSchema,
  isDefault: z.boolean().optional().default(false),
});

/**
 * Schema for updating a customer location (server action)
 */
export const updateCustomerLocationSchema = z.object({
  locationId: z.string().uuid("Invalid location ID"),
  name: z.string().trim().min(1).max(255).optional(),
  country: z.string().min(1).max(LOCATION_PART_MAX).optional(),
  stateRegion: locationPartSchema,
  city: locationPartSchema,
  gpsLatitude: optionalLatitudeSchema,
  gpsLongitude: optionalLongitudeSchema,
  address: customerLocationTextSchema.optional(),
  distanceFromFacilityKm: optionalPositiveNumber,
  distanceSource: optionalDistanceSource,
  defaultSoilTemperatureC: defaultSoilTemperatureSchema,
  isDefault: z.boolean().optional(),
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
