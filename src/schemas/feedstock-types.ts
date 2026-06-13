/**
 * Feedstock Type Validation Schemas
 * Zod schemas for feedstock type CRUD operations
 */

import { z } from "zod";

// ============================================
// Constants
// ============================================

export const pyrolysisFeedstockCategories = [
  "forestry",
  "agricultural",
  "industrial",
  "municipal",
  "invasive",
] as const;

export const blendFeedstockCategories = [
  "compost",
  "mineral",
  "lime",
  "binder",
  "amendment",
  "other",
] as const;

export const feedstockCategories = [
  ...pyrolysisFeedstockCategories,
  ...blendFeedstockCategories,
] as const;

export type FeedstockCategory = (typeof feedstockCategories)[number];

export const feedstockTypeUsages = ["pyrolysis", "blend"] as const;

export type FeedstockTypeUsage = (typeof feedstockTypeUsages)[number];

export const PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS: ReadonlyArray<{ value: FeedstockCategory; label: string }> = [
  { value: "forestry", label: "Forestry" },
  { value: "agricultural", label: "Agricultural" },
  { value: "industrial", label: "Industrial" },
  { value: "municipal", label: "Municipal" },
  { value: "invasive", label: "Invasive Species" },
];

export const BLEND_FEEDSTOCK_CATEGORY_OPTIONS: ReadonlyArray<{ value: FeedstockCategory; label: string }> = [
  { value: "compost", label: "Compost" },
  { value: "mineral", label: "Mineral" },
  { value: "lime", label: "Lime" },
  { value: "binder", label: "Binder" },
  { value: "amendment", label: "Amendment" },
  { value: "other", label: "Other Blend Material" },
];

export const FEEDSTOCK_CATEGORY_OPTIONS: ReadonlyArray<{ value: FeedstockCategory; label: string }> = [
  ...PYROLYSIS_FEEDSTOCK_CATEGORY_OPTIONS,
  ...BLEND_FEEDSTOCK_CATEGORY_OPTIONS,
];

export const FEEDSTOCK_TYPE_USAGE_OPTIONS: ReadonlyArray<{ value: FeedstockTypeUsage; label: string }> = [
  { value: "pyrolysis", label: "Pyrolysis" },
  { value: "blend", label: "Blend" },
];

const pyrolysisCategorySet = new Set<string>(pyrolysisFeedstockCategories);
const blendCategorySet = new Set<string>(blendFeedstockCategories);

function validateCategoryUsage(
  data: { category?: FeedstockCategory; usage?: FeedstockTypeUsage },
  ctx: z.RefinementCtx
) {
  if (!data.category || !data.usage) return;
  const allowedSet =
    data.usage === "pyrolysis" ? pyrolysisCategorySet : blendCategorySet;
  const allowed = allowedSet.has(data.category);

  if (!allowed) {
    const allowedList = Array.from(allowedSet).sort().join(", ");
    const suffix = allowedList ? `. Allowed: ${allowedList}` : ". No allowed categories";
    ctx.addIssue({
      code: "custom",
      path: ["category"],
      message:
        data.usage === "pyrolysis"
          ? `Select a pyrolysis feedstock category${suffix}`
          : `Select a blend material category${suffix}`,
    });
  }
}

// ============================================
// Feedstock Type Form Schema (Client-side validation)
// ============================================

export const feedstockTypeFormSchema = z.object({
  name: z
    .string()
    .min(1, "Feedstock type name is required")
    .max(255, "Name must be less than 255 characters"),
  category: z.enum(feedstockCategories, { message: "Category is required" }),
  usage: z.enum(feedstockTypeUsages, { message: "Usage is required" }),
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
}).superRefine(validateCategoryUsage);

// ============================================
// Server Action Schemas
// ============================================

export const createFeedstockTypeSchema = feedstockTypeFormSchema;

export const updateFeedstockTypeSchema = z.object({
  feedstockTypeId: z.string().uuid("Invalid feedstock type ID"),
  name: z.string().min(1).max(255).optional(),
  category: z.enum(feedstockCategories).optional(),
  usage: z.enum(feedstockTypeUsages).optional(),
  description: z.string().max(1000).optional().nullable(),
  registryUrl: z.string().max(500).optional().nullable(),
}).superRefine(validateCategoryUsage);

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
