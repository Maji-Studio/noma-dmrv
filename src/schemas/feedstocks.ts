/**
 * Feedstock Validation Schemas
 * Zod schemas for feedstock forms, server actions, and filtering
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";

// ============================================
// Feedstock Form Schema (Client-side validation)
// ============================================

export const feedstockFormSchema = z
  .object({
    // Required references
    feedstockDeliveryId: z
      .string()
      .min(1, "Please select a feedstock delivery")
      .uuid("Please select a valid feedstock delivery"),
    feedstockTypeId: z
      .string()
      .min(1, "Please select a feedstock type")
      .uuid("Please select a valid feedstock type"),
    facilityId: z
      .string()
      .min(1, "Facility is required")
      .uuid("Invalid facility"),

    // Mass & Moisture
    massDryKg: z.union([
      z.number().min(0, "Dry mass must be 0 or greater"),
      z
        .string()
        .transform((val, ctx) => {
          if (val === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Dry mass is required",
            });
            return z.NEVER;
          }
          const n = parseFloat(val);
          if (isNaN(n)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Must be a number",
            });
            return z.NEVER;
          }
          if (n < 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Dry mass must be 0 or greater",
            });
            return z.NEVER;
          }
          return n;
        }),
    ]),
    massWetKg: z
      .union([
        z.number().min(0, "Wet mass must be 0 or greater"),
        z.string().transform((val) => {
          if (val === "") return null;
          const n = parseFloat(val);
          if (isNaN(n)) return null;
          return n;
        }),
        z.null(),
      ])
      .optional()
      .nullable(),
    moistureContentPercent: z
      .union([
        z
          .number()
          .min(0, "Moisture must be between 0 and 100")
          .max(100, "Moisture must be between 0 and 100"),
        z.string().transform((val) => {
          if (val === "") return null;
          const n = parseFloat(val);
          if (isNaN(n)) return null;
          return n;
        }),
        z.null(),
      ])
      .optional()
      .nullable(),

    // Storage
    storageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
    feedstockSourceRegion: z.string().max(255).optional().or(z.literal("")),

    // Documentation
    notes: z
      .string()
      .max(2000, "Notes must be less than 2000 characters")
      .optional()
      .or(z.literal("")),
  })
  .refine(
    (data) => {
      if (
        data.massWetKg !== null &&
        data.massWetKg !== undefined &&
        typeof data.massDryKg === "number"
      ) {
        return data.massDryKg <= data.massWetKg;
      }
      return true;
    },
    {
      message: "Dry mass cannot exceed wet mass",
      path: ["massDryKg"],
    }
  );

// ============================================
// Server Action Schemas
// ============================================

export const createFeedstockSchema = feedstockFormSchema;

export const updateFeedstockSchema = z.object({
  feedstockId: z.string().uuid("Invalid feedstock ID"),
  feedstockDeliveryId: z.string().uuid().optional(),
  feedstockTypeId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  massDryKg: z.number().min(0).optional(),
  massWetKg: z.number().min(0).optional().nullable(),
  moistureContentPercent: z.number().min(0).max(100).optional().nullable(),
  storageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  feedstockSourceRegion: z.string().max(255).optional().nullable().or(z.literal("")),
  notes: z.string().max(2000).optional().nullable().or(z.literal("")),
});

export const deleteFeedstockSchema = z.object({
  feedstockId: z.string().uuid("Invalid feedstock ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

export const feedstockFilterSchema = z.object({
  search: z.string().max(255).optional(),
  facilityId: z.string().uuid().optional(),
  feedstockDeliveryId: z.string().uuid().optional(),
  feedstockTypeId: z.string().uuid().optional(),
  status: z.enum(["missing_data", "complete"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["code", "massDryKg", "createdAt", "updatedAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ============================================
// Type Inference
// ============================================

export type FeedstockFormData = z.infer<typeof feedstockFormSchema>;
export type CreateFeedstockData = z.infer<typeof createFeedstockSchema>;
export type UpdateFeedstockData = z.infer<typeof updateFeedstockSchema>;
export type DeleteFeedstockData = z.infer<typeof deleteFeedstockSchema>;
export type FeedstockFilterData = z.infer<typeof feedstockFilterSchema>;
