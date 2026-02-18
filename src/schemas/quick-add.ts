/**
 * Quick Add Validation Schemas
 * Zod schemas for inline quick-add dialog forms
 * These schemas are for rapid entity creation with minimal required fields
 */

import { z } from "zod";

// ============================================
// Driver Quick Add Schema
// ============================================

/**
 * Schema for quick-adding a driver from entity select dropdown
 * Only requires code and name for rapid creation
 */
export const driverQuickAddSchema = z.object({
  code: z
    .string()
    .max(50, "Driver code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Driver code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  name: z
    .string()
    .min(1, "Driver name is required")
    .max(255, "Driver name must be less than 255 characters"),
  licenseNumber: z
    .string()
    .max(50, "License number must be less than 50 characters")
    .optional()
    .or(z.literal("")),
  contactPhone: z
    .string()
    .max(30, "Phone number must be less than 30 characters")
    .optional()
    .or(z.literal("")),
});

// ============================================
// Vehicle Quick Add Schema
// ============================================

/**
 * Schema for quick-adding a vehicle from entity select dropdown
 */
export const vehicleQuickAddSchema = z.object({
  code: z
    .string()
    .max(50, "Vehicle code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Vehicle code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  name: z
    .string()
    .min(1, "Vehicle name is required")
    .max(255, "Vehicle name must be less than 255 characters"),
  identifier: z
    .string()
    .min(1, "Vehicle identifier/plate is required")
    .max(50, "Identifier must be less than 50 characters"),
  vehicleType: z
    .string()
    .min(1, "Vehicle type is required")
    .max(50, "Vehicle type must be less than 50 characters"),
  fuelType: z
    .string()
    .min(1, "Fuel type is required")
    .max(50, "Fuel type must be less than 50 characters"),
  fuelConsumptionLPerKm: z
    .number()
    .positive("Fuel consumption must be positive")
    .max(10, "Fuel consumption seems too high"),
  modelYear: z
    .number()
    .int("Model year must be a whole number")
    .min(1900, "Model year must be 1900 or later")
    .max(new Date().getFullYear() + 1, "Model year cannot be in the future"),
});

// ============================================
// Feedstock Type Quick Add Schema
// ============================================

/**
 * Valid feedstock categories based on schema
 */
export const feedstockCategories = [
  "forestry",
  "agricultural",
  "industrial",
  "municipal",
  "invasive",
] as const;

export type FeedstockCategory = (typeof feedstockCategories)[number];

/**
 * Schema for quick-adding a feedstock type from entity select dropdown
 */
export const feedstockTypeQuickAddSchema = z.object({
  code: z
    .string()
    .max(50, "Code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  name: z
    .string()
    .min(1, "Feedstock type name is required")
    .max(255, "Name must be less than 255 characters"),
  category: z
    .string()
    .min(1, "Category is required"),
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional()
    .or(z.literal("")),
  registryUrl: z
    .string()
    .max(500, "URL must be less than 500 characters")
    .optional()
    .nullable()
    .transform((val) => {
      if (!val || val.trim() === "") return null;
      return val;
    }),
});

// ============================================
// Type Inference
// ============================================

export type DriverQuickAddData = z.infer<typeof driverQuickAddSchema>;
export type VehicleQuickAddData = z.infer<typeof vehicleQuickAddSchema>;
export type FeedstockTypeQuickAddData = z.infer<typeof feedstockTypeQuickAddSchema>;
