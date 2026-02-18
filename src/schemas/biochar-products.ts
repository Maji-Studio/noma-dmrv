/**
 * Biochar Products Validation Schemas
 * Zod schemas for biochar product forms, server actions, and filtering
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";

// ============================================
// Status Enum
// ============================================

export const biocharProductStatusValues = ["draft", "testing", "ready", "sold"] as const;
export type BiocharProductStatus = typeof biocharProductStatusValues[number];

// ============================================
// Biochar Product Form Schema (Client-side validation)
// ============================================

/**
 * Schema for biochar product form (client-side validation)
 * Used in BiocharProductForm component for creating/editing products
 */
export const biocharProductFormSchema = z.object({
  // Required fields
  code: z
    .string()
    .max(50, "Product code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Product code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),
  formulationId: z.string().min(1, "Please select a formulation").uuid("Please select a valid formulation"),

  // Optional date field
  productionDate: z.union([
    z.date(),
    z.string().transform((val) => (val === "" ? undefined : new Date(val))),
  ]).optional(),

  // Status field
  status: z.enum(biocharProductStatusValues).default("testing"),

  // Optional relation fields
  linkedProductionRunId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .or(emptyToNull),
  storageLocationId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .or(emptyToNull),

  // Measurement fields
  massKg: z.union([
    z.number().min(0, "Mass must be a positive number"),
    z.string().transform((val) => {
      if (val === "") return null;
      const num = parseFloat(val);
      return isNaN(num) ? null : num;
    }).pipe(z.number().min(0, "Mass must be a positive number").nullable()),
    z.null(),
  ]).optional().nullable(),
  densityKgM3: z.union([
    z.number().min(0, "Density must be a positive number"),
    z.string().transform((val) => {
      if (val === "") return null;
      const num = parseFloat(val);
      return isNaN(num) ? null : num;
    }).pipe(z.number().min(0, "Density must be a positive number").nullable()),
    z.null(),
  ]).optional().nullable(),
});

// ============================================
// Server Action Schemas - Biochar Product
// ============================================

/**
 * Schema for creating a biochar product (server action)
 */
export const createBiocharProductSchema = biocharProductFormSchema;

/**
 * Schema for updating a biochar product (server action)
 * All fields optional except productId
 */
export const updateBiocharProductSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  facilityId: z.string().uuid().optional(),
  formulationId: z.string().uuid().optional(),
  productionDate: z.union([
    z.date(),
    z.string().transform((val) => (val === "" ? undefined : new Date(val))),
  ]).optional(),
  status: z.enum(biocharProductStatusValues).optional(),
  linkedProductionRunId: z.string().uuid().optional().nullable().or(emptyToNull),
  storageLocationId: z.string().uuid().optional().nullable().or(emptyToNull),
  massKg: z.number().min(0).optional().nullable(),
  densityKgM3: z.number().min(0).optional().nullable(),
});

/**
 * Schema for deleting a biochar product
 */
export const deleteBiocharProductSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering biochar products in list views
 * Used for search, pagination, and filtering
 */
export const biocharProductFilterSchema = z.object({
  // Text search across code, facility name, formulation name
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by status
  status: z.enum(biocharProductStatusValues).optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter by formulation
  formulationId: z.string().uuid().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "productionDate", "status", "massKg", "createdAt", "updatedAt"])
    .default("productionDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Schema for selecting a biochar product (e.g., in dropdowns)
 */
export const biocharProductSelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
});

// ============================================
// Type Inference
// ============================================

export type BiocharProductFormData = z.infer<typeof biocharProductFormSchema>;
export type CreateBiocharProductData = z.infer<typeof createBiocharProductSchema>;
export type UpdateBiocharProductData = z.infer<typeof updateBiocharProductSchema>;
export type DeleteBiocharProductData = z.infer<typeof deleteBiocharProductSchema>;
export type BiocharProductFilterData = z.infer<typeof biocharProductFilterSchema>;
export type BiocharProductSelectData = z.infer<typeof biocharProductSelectSchema>;
