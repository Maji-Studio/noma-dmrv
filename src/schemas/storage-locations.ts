/**
 * Storage Locations Validation Schemas
 * Zod schemas for storage location CRUD operations
 */

import { z } from "zod";
import { emptyToNull, positiveMassKgSchema } from "./helpers";

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
] as const;

export type StorageLocationType = (typeof storageLocationTypes)[number];

/**
 * Bin types that hold inputs and must be scoped to a single feedstock type.
 * Used to gate the feedstock-type requirement and the feedstock quick-add filter.
 */
export const FEEDSTOCK_BIN_TYPES = ["feedstock_bin"] as const;

export function isFeedstockBinType(
  type: StorageLocationType | undefined | null
): type is (typeof FEEDSTOCK_BIN_TYPES)[number] {
  return !!type && (FEEDSTOCK_BIN_TYPES as readonly string[]).includes(type);
}

/**
 * Short descriptions shown beneath the bin-type picker.
 */
export const STORAGE_LOCATION_TYPE_DESCRIPTIONS: Record<StorageLocationType, string> = {
  feedstock_bin: "Holds input material. What it can feed depends on the held feedstock type usage.",
  biochar_bin: "Holds finished biochar after production, before blending or packing.",
  product_bin: "Holds a packed, sellable product — optionally tied to one formulation.",
};

const FORMULATION_PRODUCT_BIN_MESSAGE =
  "formulationId is only allowed for product_bin storageMethod";

const FEEDSTOCK_TYPE_REQUIRED_MESSAGE =
  "Feedstock bins must be restricted to one feedstock type";

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
    .trim()
    .min(1, "Storage bin name is required")
    .max(255, "Name must be less than 255 characters"),
  type: z.enum(storageLocationTypes, {
    message: "Please select a valid storage type",
  }),
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),

  // Optional fields
  capacityKg: positiveMassKgSchema("Capacity must be a positive number")
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
}).superRefine((data, ctx) => {
  if (data.formulationId && data.type !== "product_bin") {
    ctx.addIssue({
      code: "custom",
      path: ["formulationId"],
      message: FORMULATION_PRODUCT_BIN_MESSAGE,
    });
  }
  if (isFeedstockBinType(data.type) && !data.feedstockTypeId) {
    ctx.addIssue({
      code: "custom",
      path: ["feedstockTypeId"],
      message: FEEDSTOCK_TYPE_REQUIRED_MESSAGE,
    });
  }
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
  storageLocationId: z.string().uuid("Invalid storage bin ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  name: z.string().trim().min(1).max(255).optional(),
  type: z.enum(storageLocationTypes).optional(),
  facilityId: z.string().uuid().optional(),
  capacityKg: positiveMassKgSchema().optional().nullable(),
  feedstockTypeId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  formulationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  storageMethod: z.string().max(255).optional().nullable(),
  storageDescription: z.string().max(1000).optional().nullable(),
  supplierReferenceId: z.string().max(100).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.formulationId && data.type && data.type !== "product_bin") {
    ctx.addIssue({
      code: "custom",
      path: ["formulationId"],
      message: FORMULATION_PRODUCT_BIN_MESSAGE,
    });
  }
  // Partial update: only flag an explicit clear (null). When feedstockTypeId is
  // omitted, the data-access layer validates the invariant against the merged
  // existing row — flagging here would reject type-only updates of bins that
  // already carry a feedstock type.
  if (isFeedstockBinType(data.type) && data.feedstockTypeId === null) {
    ctx.addIssue({
      code: "custom",
      path: ["feedstockTypeId"],
      message: FEEDSTOCK_TYPE_REQUIRED_MESSAGE,
    });
  }
});

/**
 * Schema for deleting a storage location
 */
export const deleteStorageLocationSchema = z.object({
  storageLocationId: z.string().uuid("Invalid storage bin ID"),
});

/**
 * Schemas for reversible storage-location lifecycle actions.
 */
export const archiveStorageLocationSchema = deleteStorageLocationSchema;
export const restoreStorageLocationSchema = deleteStorageLocationSchema;

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

  // false (default) = active bins only; true = archived bins only
  archived: z.boolean().default(false),

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
export type ArchiveStorageLocationData = z.infer<
  typeof archiveStorageLocationSchema
>;
export type RestoreStorageLocationData = z.infer<
  typeof restoreStorageLocationSchema
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
    feedstock_bin: "Feedstock bin",
    biochar_bin: "Biochar bin",
    product_bin: "Product bin",
  };
  return labels[type];
}
