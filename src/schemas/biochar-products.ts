/**
 * Biochar Products Validation Schemas
 * Zod schemas for biochar product forms, server actions, and filtering
 */

import { z } from "zod";
import {
  emptyToNull,
  massKgSchema,
  optionalPositiveNumber,
  requiredMassKgSchema,
  requiredNumber,
  requiredPositiveMassKgSchema,
  storedPercentSchema,
} from "./helpers";

// ============================================
// Constants
// ============================================

export const MOISTURE_MIN = 0;
export const MOISTURE_MAX = 100;

const requiredNonNegativeNumber = (message: string) =>
  requiredMassKgSchema(message);

const requiredPercent = requiredNumber().pipe(
  storedPercentSchema()
    .min(MOISTURE_MIN, "Must be 0-100")
    .max(MOISTURE_MAX, "Must be 0-100")
);

// ============================================
// Status Enum
// ============================================

export const biocharProductStatusValues = ["draft", "testing", "ready", "sold"] as const;
export type BiocharProductStatus = typeof biocharProductStatusValues[number];

/**
 * Sentinel passed as `filterBy.formulationId` on the product-bin EntitySelect when
 * NO formulation is selected (pure-biochar product). The storage-location entity
 * query maps this to "only pure/unassigned bins". A real formulation id instead
 * maps to "matching OR unassigned bins". Shared by the form (client) and the
 * entity dispatcher (server) so the magic value lives in one place.
 */
export const PURE_PRODUCT_BIN_FILTER = "pure" as const;

// ============================================
// Ingredient Bin Schema (shared between form and update)
// ============================================

const ingredientBinBaseSchema = z.object({
  formulationIngredientId: z.string().uuid(),
  feedstockTypeId: z.string().uuid(),
  feedstockTypeName: z.string(),
  feedstockTypeCategory: z.string(),
  // Recipe share snapshot — orientation only. The entered massKg is the
  // record of what actually went into the blend; it is never validated
  // against the ratio (deviation surfaces as a soft UI hint instead).
  ratio: z.number().min(0).max(1).optional().nullable(),
  massKg: massKgSchema("Ingredient mass must be 0 or greater"),
});

const ingredientBinFormSchema = ingredientBinBaseSchema.extend({
  storageLocationId: emptyToNull.or(z.string().uuid()).optional().nullable(),
  massKg: requiredNumber(
    "Ingredient mass is required",
    "Ingredient mass must be a number",
  ).pipe(massKgSchema("Ingredient mass must be 0 or greater")),
});

const ingredientBinUpdateSchema = ingredientBinBaseSchema.extend({
  storageLocationId: z.string().uuid().optional().nullable(),
});

export type IngredientBin = z.infer<typeof ingredientBinFormSchema>;

// ============================================
// Biochar Product Form Schema (Client-side validation)
// ============================================

/**
 * Schema for biochar product form (client-side validation)
 * Used in BiocharProductForm component for creating/editing products
 */
export const biocharProductFormSchema = z.object({
  // Required fields
  facilityId: z.string().min(1, "Select a facility.").uuid("Choose a valid facility."),
  // Optional: empty = pure-biochar product (no amendment blend)
  formulationId: emptyToNull.or(z.string().uuid("Choose a valid formulation.")).nullable().optional(),

  // No productionDate here: it is derived server-side from the oldest
  // production-run lot allocated from the selected source bin.

  // Status field
  status: z.enum(biocharProductStatusValues).default("testing"),

  // Source and destination bins. The server resolves the source-bin draw to
  // immutable production-run lots; operators never need to choose an internal
  // production-run record.
  sourceBiocharStorageLocationId: z
    .string()
    .min(1, "Select a biochar bin.")
    .uuid("Choose a valid biochar bin."),
  storageLocationId: z
    .string()
    .min(1, "Select a product bin.")
    .uuid("Choose a valid storage bin."),

  // Measurement fields (setValueAs in form converts "" to null and strings to numbers)
  massKg: requiredPositiveMassKgSchema(
    "Wet mass is required",
    "Wet mass must be a number",
    "Wet mass must be greater than 0",
  ),
  moistureContentPercent: requiredPercent,
  densityKgM3: optionalPositiveNumber,
  waterAddedKg: requiredNonNegativeNumber("Water added must be 0 or greater"),

  // Ingredient bin mappings (formulation ingredient → physical bin)
  ingredientBins: z.array(ingredientBinFormSchema).optional(),
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
  productId: z.string().uuid("Choose a valid biochar product."),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  facilityId: z.string().uuid().optional(),
  formulationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  status: z.enum(biocharProductStatusValues).optional(),
  sourceBiocharStorageLocationId: z
    .string()
    .uuid("Choose a valid biochar bin.")
    .optional(),
  storageLocationId: z.string().uuid("Choose a valid storage bin.").optional(),
  massKg: massKgSchema().optional(),
  moistureContentPercent: storedPercentSchema()
    .min(MOISTURE_MIN)
    .max(MOISTURE_MAX)
    .optional(),
  densityKgM3: z.number().min(0).optional().nullable(),
  waterAddedKg: massKgSchema().optional(),
  ingredientBins: z.array(ingredientBinUpdateSchema).optional(),
});

/**
 * Schema for deleting a biochar product
 */
export const deleteBiocharProductSchema = z.object({
  productId: z.string().uuid("Choose a valid biochar product."),
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

  // Filter by the credit batch containing the linked production run
  creditBatchId: z.string().uuid().optional(),

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
