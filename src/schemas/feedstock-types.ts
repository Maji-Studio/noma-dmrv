/**
 * Feedstock Type Validation Schemas
 * Zod schemas for feedstock type CRUD operations
 */

import { z } from "zod";

// ============================================
// Constants
// ============================================

export const feedstockCategories = [
  "forestry",
  "agricultural",
  "industrial",
  "municipal",
  "invasive",
  "ingredient",
] as const;

export type FeedstockCategory = (typeof feedstockCategories)[number];

export const FEEDSTOCK_CATEGORY_OPTIONS: ReadonlyArray<{ value: FeedstockCategory; label: string }> = [
  { value: "forestry", label: "Forestry" },
  { value: "agricultural", label: "Agricultural" },
  { value: "industrial", label: "Industrial" },
  { value: "municipal", label: "Municipal" },
  { value: "invasive", label: "Invasive Species" },
  { value: "ingredient", label: "Ingredient" },
];

// ============================================
// Feedstock Type Form Schema (Client-side validation)
// ============================================

export const feedstockTypeFormSchema = z.object({
  name: z
    .string()
    .min(1, "Feedstock type name is required")
    .max(255, "Name must be less than 255 characters"),
  category: z.enum(feedstockCategories, { message: "Category is required" }),
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
  registryUrl: z
    .string()
    .max(500, "URL must be less than 500 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas
// ============================================

export const createFeedstockTypeSchema = feedstockTypeFormSchema;

export const updateFeedstockTypeSchema = z.object({
  feedstockTypeId: z.string().uuid("Invalid feedstock type ID"),
  name: z.string().min(1).max(255).optional(),
  category: z.enum(feedstockCategories).optional(),
  description: z.string().max(1000).optional().nullable(),
  registryUrl: z.string().max(500).optional().nullable(),
});

export const deleteFeedstockTypeSchema = z.object({
  feedstockTypeId: z.string().uuid("Invalid feedstock type ID"),
});

// ============================================
// Type Inference
// ============================================

export type FeedstockTypeFormData = z.infer<typeof feedstockTypeFormSchema>;
export type CreateFeedstockTypeData = z.infer<typeof createFeedstockTypeSchema>;
export type UpdateFeedstockTypeData = z.infer<typeof updateFeedstockTypeSchema>;
export type DeleteFeedstockTypeData = z.infer<typeof deleteFeedstockTypeSchema>;
