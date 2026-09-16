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

/**
 * The one rule that decides whether a category belongs to a usage. Both the
 * form refine and the server-side merged check read it, so a patch that names
 * only one of the pair cannot reach a combination the form would reject.
 */
export function categoryMatchesUsage(
  // `feedstock_types.category` is a text column, so a stored value read back
  // for the merged check arrives as a plain string, not the narrowed union.
  category: string,
  usage: FeedstockTypeUsage,
): boolean {
  const allowedSet =
    usage === "pyrolysis" ? pyrolysisCategorySet : blendCategorySet;
  return allowedSet.has(category);
}

/** Field-level message for a category that does not belong to the usage. */
export function categoryUsageMismatchMessage(
  usage: FeedstockTypeUsage,
): string {
  const allowedSet =
    usage === "pyrolysis" ? pyrolysisCategorySet : blendCategorySet;
  const allowedList = Array.from(allowedSet).sort().join(", ");
  const suffix = allowedList
    ? `. Allowed: ${allowedList}`
    : ". No allowed categories";
  return usage === "pyrolysis"
    ? `Select a pyrolysis feedstock category${suffix}`
    : `Select a blend material category${suffix}`;
}

/**
 * Record-level message for a merged patch. The form refine can point at the
 * Category field; a partial update that supplies only one half of the pair
 * cannot, so it names both fields instead.
 */
export const FEEDSTOCK_TYPE_CATEGORY_USAGE_CONFLICT_MESSAGE =
  "Feedstock type was not saved because its category and usage disagree. " +
  "Review Category and Usage.";

function validateCategoryUsage(
  data: { category?: FeedstockCategory; usage?: FeedstockTypeUsage },
  ctx: z.RefinementCtx
) {
  if (!data.category || !data.usage) return;
  if (categoryMatchesUsage(data.category, data.usage)) return;
  ctx.addIssue({
    code: "custom",
    path: ["category"],
    message: categoryUsageMismatchMessage(data.usage),
  });
}

// ============================================
// Feedstock Type Form Schema (Client-side validation)
// ============================================

export const feedstockTypeFormSchema = z.object({
  name: z
    .string()
    .trim()
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
    .union([z.url("Enter a valid URL"), z.literal("")])
    .optional()
    .nullable(),
  isometricFeedstockTypeId: z.string().trim().max(255).optional().nullable(),
}).superRefine(validateCategoryUsage);

// ============================================
// Server Action Schemas
// ============================================

export const createFeedstockTypeSchema = feedstockTypeFormSchema;

export const updateFeedstockTypeSchema = z.object({
  feedstockTypeId: z.uuid("Choose a valid feedstock type."),
  name: z.string().trim().min(1).max(255).optional(),
  category: z.enum(feedstockCategories).optional(),
  usage: z.enum(feedstockTypeUsages).optional(),
  description: z.string().max(1000).optional().nullable(),
  registryUrl: z.union([z.url(), z.literal("")]).optional().nullable(),
  isometricFeedstockTypeId: z.string().trim().max(255).optional().nullable(),
}).superRefine(validateCategoryUsage);

export const deleteFeedstockTypeSchema = z.object({
  feedstockTypeId: z.uuid("Choose a valid feedstock type."),
});

export const importIsometricFeedstockTypeSchema = z.object({
  isometricFeedstockTypeId: z.string().trim().min(1).max(255),
  category: z.enum(pyrolysisFeedstockCategories),
});

// ============================================
// Type Inference
// ============================================

export type FeedstockTypeFormData = z.infer<typeof feedstockTypeFormSchema>;
export type CreateFeedstockTypeData = z.infer<typeof createFeedstockTypeSchema>;
export type UpdateFeedstockTypeData = z.infer<typeof updateFeedstockTypeSchema>;
export type ImportIsometricFeedstockTypeData = z.infer<
  typeof importIsometricFeedstockTypeSchema
>;
