/**
 * Biochar Products Validation Schemas
 * Zod schemas for biochar product forms, server actions, and filtering
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";
import { optionalPositiveNumber, toNumberOrNull } from "./helpers";

// ============================================
// Constants
// ============================================

export const MOISTURE_MIN = 0;
export const MOISTURE_MAX = 100;

const requiredNonNegativeNumber = (message: string) => z.preprocess(
  toNumberOrNull,
  z.number().finite().min(0, message)
);

const requiredPercent = z.preprocess(
  toNumberOrNull,
  z
    .number()
    .min(MOISTURE_MIN, "Must be 0-100")
    .max(MOISTURE_MAX, "Must be 0-100")
);

// ============================================
// Status Enum
// ============================================

export const biocharProductStatusValues = ["draft", "testing", "ready", "sold"] as const;
export type BiocharProductStatus = typeof biocharProductStatusValues[number];

// ============================================
// Ingredient Bin Schema (shared between form and update)
// ============================================

const ingredientBinBaseSchema = z.object({
  formulationIngredientId: z.string().uuid(),
  ingredientName: z.string(),
  ingredientType: z.string(),
  ratio: z.number().min(0).max(1).optional().nullable(),
  massKg: z.number().min(0).optional().nullable(),
});

const ingredientBinFormSchema = ingredientBinBaseSchema.extend({
  storageLocationId: emptyToNull.or(z.string().uuid()).optional().nullable(),
  massKg: z.preprocess(toNumberOrNull, z.number().min(0).optional().nullable()),
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
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),
  formulationId: z.string().min(1, "Please select a formulation").uuid("Please select a valid formulation"),

  // Optional date field
  productionDate: z.union([
    z.date(),
    z.string().transform((val) => {
      if (val === "") return undefined;
      const date = new Date(val);
      if (isNaN(date.getTime())) return undefined;
      return date;
    }),
  ]).optional(),

  // Status field
  status: z.enum(biocharProductStatusValues).default("testing"),

  // Optional relation fields (empty string → null, otherwise must be valid UUID)
  linkedProductionRunId: z
    .string()
    .min(1, "Please select a production run")
    .uuid("Invalid production run"),
  storageLocationId: z
    .string()
    .min(1, "Please select a product bin")
    .uuid("Invalid storage location"),

  // Measurement fields (setValueAs in form converts "" to null and strings to numbers)
  massKg: requiredNonNegativeNumber("Wet mass must be 0 or greater"),
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
    z.string().transform((val) => {
      if (val === "") return undefined;
      const date = new Date(val);
      if (isNaN(date.getTime())) return undefined;
      return date;
    }),
  ]).optional(),
  status: z.enum(biocharProductStatusValues).optional(),
  linkedProductionRunId: z.string().uuid("Invalid production run").optional(),
  storageLocationId: z.string().uuid("Invalid storage location").optional(),
  massKg: z.number().min(0).optional(),
  moistureContentPercent: z.number().min(MOISTURE_MIN).max(MOISTURE_MAX).optional(),
  densityKgM3: z.number().min(0).optional().nullable(),
  waterAddedKg: z.number().min(0).optional(),
  ingredientBins: z.array(ingredientBinUpdateSchema).optional(),
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
