/**
 * Driver Validation Schemas
 * Zod schemas for driver CRUD operations
 */

import { z } from "zod";

// ============================================
// Driver Form Schema (Client-side validation)
// ============================================

export const driverFormSchema = z.object({
  name: z
    .string()
    .min(1, "Driver name is required")
    .max(255, "Driver name must be less than 255 characters"),
  licenseNumber: z
    .string()
    .max(50, "License number must be less than 50 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
  contactPhone: z
    .string()
    .max(30, "Phone number must be less than 30 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas
// ============================================

export const createDriverSchema = driverFormSchema;

export const updateDriverSchema = z.object({
  driverId: z.string().uuid("Invalid driver ID"),
  name: z.string().min(1).max(255).optional(),
  licenseNumber: z.string().max(50).optional().nullable(),
  contactPhone: z.string().max(30).optional().nullable(),
});

export const deleteDriverSchema = z.object({
  driverId: z.string().uuid("Invalid driver ID"),
});

// ============================================
// Type Inference
// ============================================

export type DriverFormData = z.infer<typeof driverFormSchema>;
export type CreateDriverData = z.infer<typeof createDriverSchema>;
export type UpdateDriverData = z.infer<typeof updateDriverSchema>;
export type DeleteDriverData = z.infer<typeof deleteDriverSchema>;
