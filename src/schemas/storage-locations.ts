/**
 * Storage Locations Validation Schemas
 * Zod schemas for storage location CRUD operations
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";

// ============================================
// Constants and Enums
// ============================================

/**
 * Valid storage location types for biochar production
 */
export const storageLocationTypes = [
  "feedstock_bin",
  "biochar_bin",
  "product_bin",
  "ingredient_bin",
] as const;

export type StorageLocationType = (typeof storageLocationTypes)[number];

// ============================================
// Storage Location Form Schema (Client-side validation)
// ============================================

/**
 * Schema for storage location form (client-side validation)
 * Used in StorageLocationForm component for creating/editing storage locations
 */
export const storageLocationFormSchema = z.object({
  // Required fields
  name: z
    .string()
    .min(1, "Storage location name is required")
    .max(255, "Name must be less than 255 characters"),
  type: z.enum(storageLocationTypes, {
    message: "Please select a valid storage type",
  }),
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),

  // Optional fields
  capacityKg: z
    .number()
    .positive("Capacity must be a positive number")
    .optional()
    .nullable(),
  feedstockTypeId: emptyToNull.or(z.string().uuid("Invalid feedstock type")).nullable().optional(),
  // Product bins only — restricts the bin to one formulation (empty = pure biochar)
  formulationId: emptyToNull.or(z.string().uuid("Invalid formulation")).nullable().optional(),
  storageMethod: z
    .string()
    .max(255, "Storage method must be less than 255 characters")
    .optional()
    .or(z.literal("")),
  storageDescription: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a storage location (server action)
 * Same as form schema - all required fields must be present
 */
export const createStorageLocationSchema = storageLocationFormSchema;

/**
 * Schema for updating a storage location (server action)
 * All fields optional except storageLocationId
 */
export const updateStorageLocationSchema = z.object({
  storageLocationId: z.string().uuid("Invalid storage location ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  name: z.string().min(1).max(255).optional(),
  type: z.enum(storageLocationTypes).optional(),
  facilityId: z.string().uuid().optional(),
  capacityKg: z.number().positive().optional().nullable(),
  feedstockTypeId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  formulationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  storageMethod: z.string().max(255).optional().nullable(),
  storageDescription: z.string().max(1000).optional().nullable(),
  supplierReferenceId: z.string().max(100).optional().nullable(),
});

/**
 * Schema for deleting a storage location
 */
export const deleteStorageLocationSchema = z.object({
  storageLocationId: z.string().uuid("Invalid storage location ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering storage locations in list views
 * Used for search, pagination, and filtering
 */
export const storageLocationFilterSchema = z.object({
  // Text search across code, name
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter by storage type
  type: z.enum(storageLocationTypes).optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "name", "type", "capacityKg", "createdAt", "updatedAt"])
    .default("code"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// ============================================
// Type Inference
// ============================================

export type StorageLocationFormData = z.infer<typeof storageLocationFormSchema>;
export type CreateStorageLocationData = z.infer<
  typeof createStorageLocationSchema
>;
export type UpdateStorageLocationData = z.infer<
  typeof updateStorageLocationSchema
>;
export type DeleteStorageLocationData = z.infer<
  typeof deleteStorageLocationSchema
>;
export type StorageLocationFilterData = z.infer<
  typeof storageLocationFilterSchema
>;

// ============================================
// Helper Functions
// ============================================

/**
 * Format storage location type for display
 */
export function formatStorageLocationType(type: StorageLocationType): string {
  const labels: Record<StorageLocationType, string> = {
    feedstock_bin: "Feedstock Bin",
    biochar_bin: "Biochar Bin",
    product_bin: "Product Bin",
    ingredient_bin: "Ingredient Bin",
  };
  return labels[type];
}

