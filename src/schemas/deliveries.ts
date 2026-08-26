/**
 * Deliveries Validation Schemas
 * Zod schemas for delivery forms, server actions, and filtering
 * Delivery dry biochar is derived server-side from the linked product.
 */

import { z } from "zod";
import { deliveryDryMassSchema } from "./isometric";
import {
  optionalDistanceSource,
  resolveDistanceSource,
  type DistanceSourceValue,
} from "./distance-source";
import { optionalTripType } from "./trip-type";
import {
  emptyToNull,
  optionalMassKgSchema,
  requiredNumber,
  storedPercentSchema,
} from "./helpers";

// ============================================
// Constants and Enums
// ============================================

/**
 * Valid delivery statuses
 */
export const deliveryStatuses = ["upcoming", "delivered"] as const;

export type DeliveryStatus = (typeof deliveryStatuses)[number];

/**
 * A delivery may carry trip-specific documentary provenance while continuing
 * to inherit the customer location's distance (a null distance override).
 */
export function resolveDeliveryDistanceSource(
  distanceKmOverride: number | null | undefined,
  source: DistanceSourceValue | null | undefined,
): DistanceSourceValue | null | undefined {
  return source === "document"
    ? "document"
    : resolveDistanceSource(distanceKmOverride, source);
}

// ============================================
// Helper Schemas
// ============================================

const optionalNumber = z.number().finite().optional().nullable();
const WET_MASS_RANGE_MESSAGE = "Wet mass must be 0 or more";
const DISTANCE_RANGE_MESSAGE = "Distance must be 0 or more";
const optionalWetMassKg = optionalMassKgSchema(WET_MASS_RANGE_MESSAGE);
const requiredProductMoisturePercent = requiredNumber(
  "Biochar product moisture is required",
  "Enter a valid biochar product moisture percentage",
).pipe(
  storedPercentSchema()
    .min(0, "Moisture content must be 0% or more")
    .max(100, "Moisture content must be 100% or less"),
);
const optionalNote = z.string().max(500, "Note must be less than 500 characters").optional().nullable().or(z.literal(""));

function validateDistanceOverride(
  value: { distanceKmOverride?: number | null },
  ctx: z.RefinementCtx
) {
  if (value.distanceKmOverride != null && value.distanceKmOverride < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["distanceKmOverride"],
      message: DISTANCE_RANGE_MESSAGE,
    });
  }
}

// ============================================
// Delivery Form Schema (Client-side validation)
// ============================================

/**
 * Base delivery schema without cross-field validation
 */
const deliveryFormBaseSchema = z.object({
  // Required fields
  orderId: z.string().min(1, "Select an order.").uuid("Choose a valid order."),
  deliveryDate: z.coerce.date({ error: "Delivery date is required" }),

  // Optional fields
  biocharProductId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  driverId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  vehicleId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  status: z.enum(deliveryStatuses).default("upcoming"),
  deliveredWetMassKg: optionalWetMassKg,
  moistureContentPercent: requiredProductMoisturePercent,
  // Per-delivery road-distance override (km) + reason for the distribution leg.
  distanceKmOverride: optionalNumber,
  distanceSource: optionalDistanceSource,
  distanceNote: optionalNote,
  // Round-trip vs one-way accounting for the distribution leg (issue #316).
  tripType: optionalTripType,
});

/**
 * Schema for delivery form with cross-field validation
 * Validates delivery-entered fields. Dry biochar is not a form input.
 */
export const deliveryFormSchema = deliveryFormBaseSchema.superRefine((value, ctx) => {
  validateDistanceOverride(value, ctx);
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating a delivery (server action)
 * Same as form schema with additional server-side fields
 */
export const createDeliverySchema = z.object({
  code: z
    .string()
    .min(1, "Delivery code is required")
    .max(50)
    .regex(/^[A-Z0-9-]+$/),
  orderId: z.string().min(1, "Select an order.").uuid("Choose a valid order."),
  facilityId: z.string().min(1, "Select a facility.").uuid("Choose a valid facility."),
  deliveryDate: z.coerce.date(),
  biocharProductId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  driverId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  vehicleId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  status: z.enum(deliveryStatuses).default("upcoming"),
  deliveredWetMassKg: optionalWetMassKg,
  moistureContentPercent: requiredProductMoisturePercent,
  distanceKmOverride: optionalNumber,
  distanceSource: optionalDistanceSource,
  distanceNote: optionalNote,
  tripType: optionalTripType,
}).superRefine((value, ctx) => {
  validateDistanceOverride(value, ctx);
});

/**
 * Schema for updating a delivery (server action)
 * All fields optional except deliveryId
 */
export const updateDeliverySchema = z.object({
  deliveryId: z.string().uuid("Choose a valid delivery."),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  orderId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  deliveryDate: z.coerce.date().optional(),
  biocharProductId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  driverId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  vehicleId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  status: z.enum(deliveryStatuses).optional(),
  deliveredWetMassKg: optionalWetMassKg,
  moistureContentPercent: requiredProductMoisturePercent.optional(),
  distanceKmOverride: optionalNumber,
  distanceSource: optionalDistanceSource,
  distanceNote: optionalNote,
  tripType: optionalTripType,
}).superRefine((value, ctx) => {
  validateDistanceOverride(value, ctx);
});

/**
 * Schema for deleting a delivery
 */
export const deleteDeliverySchema = z.object({
  deliveryId: z.string().uuid("Choose a valid delivery."),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering deliveries in list views
 * Used for search, pagination, and filtering
 */
export const deliveryFilterSchema = z.object({
  // Text search across code
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by order
  orderId: z.string().uuid().optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter through production-run membership in a credit batch
  creditBatchId: z.string().uuid().optional(),

  // Filter by status
  status: z.enum(deliveryStatuses).optional(),

  // Filter by date range
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum([
      "code",
      "deliveryDate",
      "deliveredWetMassKg",
      "massDryKg",
      "status",
      "createdAt",
      "updatedAt",
    ])
    .default("deliveryDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Schema for selecting a delivery (e.g., in dropdowns)
 */
export const deliverySelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  deliveryDate: z.date(),
  status: z.enum(deliveryStatuses),
  orderCode: z.string().optional(),
});

// ============================================
// Type Inference
// ============================================

export type DeliveryFormData = z.infer<typeof deliveryFormSchema>;
export type CreateDeliveryData = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryData = z.infer<typeof updateDeliverySchema>;
export type DeleteDeliveryData = z.infer<typeof deleteDeliverySchema>;
export type DeliveryFilterData = z.infer<typeof deliveryFilterSchema>;
export type DeliverySelectData = z.infer<typeof deliverySelectSchema>;

// Re-export the delivery dry mass schema for use in forms
export { deliveryDryMassSchema };
