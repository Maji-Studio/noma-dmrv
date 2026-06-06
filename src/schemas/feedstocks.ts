/**
 * Feedstock Validation Schemas
 * Unified schemas for the combined delivery + bin allocation workflow.
 */

import { z } from "zod";
import { emptyToNull, optionalPositiveNumber, toNumberOrNull } from "./helpers";

// ============================================
// Shared numeric field helpers
// ============================================

const requiredNonNegativeNumber = z.preprocess(
  toNumberOrNull,
  z.number().min(0, "Must be 0 or greater")
);

const requiredMoisturePercent = z.preprocess(
  toNumberOrNull,
  z
    .number()
    .min(0, "Moisture must be between 0 and 100")
    .max(100, "Moisture must be between 0 and 100")
);

// ============================================
// Bin Allocation Schema
// ============================================

export const binAllocationSchema = z.object({
  storageLocationId: z
    .string()
    .min(1, "Please select a storage bin")
    .uuid("Please select a valid storage bin"),
  allocatedWetMassKg: z.preprocess(
    toNumberOrNull,
    z
      .number()
      .min(0, "Must be 0 or greater")
  ),
});

export type BinAllocation = z.infer<typeof binAllocationSchema>;

// ============================================
// Feedstock Form Schema (Client-side)
// ============================================

export const feedstockFormSchema = z.object({
  // --- Delivery fields ---
  facilityId: z
    .string()
    .min(1, "Please select a facility")
    .uuid("Please select a valid facility"),
  deliveryDate: z.union([
    z.date(),
    z.string().transform((val, ctx) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
        return z.NEVER;
      }
      return date;
    }),
  ]),
  supplierId: z
    .string()
    .min(1, "Please select a supplier")
    .uuid("Please select a valid supplier"),

  // Optional transport
  vehicleId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  // Road distance (km) for the feedstock transport leg — autofills from the
  // supplier's distance-to-facility, overridable per delivery.
  transportDistanceKm: optionalPositiveNumber,

  // --- Material ---
  feedstockTypeId: z
    .string()
    .min(1, "Please select a feedstock type")
    .uuid("Please select a valid feedstock type"),
  totalWetMassKg: requiredNonNegativeNumber,
  moisturePercent: requiredMoisturePercent,

  // --- Bin Allocations ---
  allocations: z
    .array(binAllocationSchema)
    .min(1, "At least one bin allocation is required"),

  // --- Override ---
  overrideJustification: z
    .string()
    .max(2000, "Justification must be less than 2000 characters")
    .optional()
    .or(z.literal("")),

  // --- Documentation ---
  notes: z
    .string()
    .max(2000, "Notes must be less than 2000 characters")
    .optional()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas
// ============================================

export const createFeedstockSchema = feedstockFormSchema;

export const updateFeedstockSchema = z.object({
  feedstockId: z.string().uuid("Invalid feedstock ID"),
  facilityId: z.string().uuid().optional(),
  deliveryDate: z.union([
    z.date(),
    z.string().transform((val, ctx) => {
      const date = new Date(val);
      if (isNaN(date.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
        return z.NEVER;
      }
      return date;
    }),
  ]).optional(),
  supplierId: z.string().uuid().optional(),
  vehicleId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  transportDistanceKm: optionalPositiveNumber,
  feedstockTypeId: z.string().uuid().optional(),
  massWetKg: z.number().min(0).optional(),
  moistureContentPercent: z.number().min(0).max(100).optional(),
  massDryKg: z.number().min(0).optional(),
  storageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  overrideJustification: z.string().max(2000).optional().nullable().or(z.literal("")),
  notes: z.string().max(2000).optional().nullable().or(z.literal("")),
});

export const deleteFeedstockSchema = z.object({
  feedstockId: z.string().uuid("Invalid feedstock ID"),
});

// ============================================
// Filter Schema
// ============================================

export const feedstockFilterSchema = z.object({
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),
  facilityId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  feedstockTypeId: z.string().uuid().optional(),
  status: z.enum(["missing_data", "complete"]).optional(),
  storageLocationId: z.string().uuid().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["code", "deliveryDate", "massDryKg", "massWetKg", "createdAt", "updatedAt"])
    .default("deliveryDate"),
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
