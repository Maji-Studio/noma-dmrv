/**
 * Deliveries Validation Schemas
 * Zod schemas for delivery forms, server actions, and filtering
 * Includes massDryKg <= deliveredWetMassKg validation from isometric.ts
 */

import { z } from "zod";
import { deliveryDryMassSchema } from "./isometric";
import { emptyToNull } from "./helpers";

// ============================================
// Constants and Enums
// ============================================

/**
 * Valid delivery statuses
 */
export const deliveryStatuses = ["scheduled", "processing", "delivered"] as const;

export type DeliveryStatus = (typeof deliveryStatuses)[number];

// ============================================
// Helper Schemas
// ============================================

const optionalNumber = z.number().finite().optional().nullable();

// ============================================
// Delivery Form Schema (Client-side validation)
// ============================================

/**
 * Base delivery schema without cross-field validation
 */
const deliveryFormBaseSchema = z.object({
  // Required fields
  code: z
    .string()
    .max(50, "Delivery code must be less than 50 characters")
    .regex(
      /^[A-Z0-9-]+$/,
      "Delivery code must contain only uppercase letters, numbers, and hyphens"
    )
    .optional()
    .or(z.literal("")),
  orderId: z.string().min(1, "Please select an order").uuid("Invalid order"),
  deliveryDate: z.coerce.date({ error: "Delivery date is required" }),

  // Optional fields
  biocharProductId: z.string().uuid().optional().nullable().or(emptyToNull),
  driverId: z.string().uuid().optional().nullable().or(emptyToNull),
  vehicleId: z.string().uuid().optional().nullable().or(emptyToNull),
  status: z.enum(deliveryStatuses).default("processing"),
  deliveredWetMassKg: optionalNumber,
  massDryKg: optionalNumber,
  moistureContentPercent: optionalNumber,
});

/**
 * Schema for delivery form with cross-field validation
 * Validates: massDryKg <= deliveredWetMassKg
 */
export const deliveryFormSchema = deliveryFormBaseSchema.superRefine((value, ctx) => {
  // Reuse validation logic from isometric schema
  if (value.massDryKg != null && value.massDryKg < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["massDryKg"],
      message: "Dry mass must be >= 0",
    });
  }

  if (
    value.massDryKg != null &&
    value.deliveredWetMassKg != null &&
    value.massDryKg > value.deliveredWetMassKg
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["massDryKg"],
      message: "Dry mass must be less than or equal to wet mass",
    });
  }

  if (value.moistureContentPercent != null) {
    if (value.moistureContentPercent < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["moistureContentPercent"],
        message: "Moisture content must be >= 0%",
      });
    }
    if (value.moistureContentPercent > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["moistureContentPercent"],
        message: "Moisture content must be <= 100%",
      });
    }
  }
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
  orderId: z.string().min(1, "Please select an order").uuid("Invalid order"),
  facilityId: z.string().min(1, "Facility is required").uuid("Invalid facility"),
  deliveryDate: z.coerce.date(),
  biocharProductId: z.string().uuid().optional().nullable().or(emptyToNull),
  driverId: z.string().uuid().optional().nullable().or(emptyToNull),
  vehicleId: z.string().uuid().optional().nullable().or(emptyToNull),
  status: z.enum(deliveryStatuses).default("processing"),
  deliveredWetMassKg: optionalNumber,
  massDryKg: optionalNumber,
  moistureContentPercent: optionalNumber,
}).superRefine((value, ctx) => {
  if (value.massDryKg != null && value.massDryKg < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["massDryKg"],
      message: "Dry mass must be >= 0",
    });
  }

  if (
    value.massDryKg != null &&
    value.deliveredWetMassKg != null &&
    value.massDryKg > value.deliveredWetMassKg
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["massDryKg"],
      message: "Dry mass must be less than or equal to wet mass",
    });
  }
});

/**
 * Schema for updating a delivery (server action)
 * All fields optional except deliveryId
 */
export const updateDeliverySchema = z.object({
  deliveryId: z.string().uuid("Invalid delivery ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  orderId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  deliveryDate: z.coerce.date().optional(),
  biocharProductId: z.string().uuid().optional().nullable().or(emptyToNull),
  driverId: z.string().uuid().optional().nullable().or(emptyToNull),
  vehicleId: z.string().uuid().optional().nullable().or(emptyToNull),
  status: z.enum(deliveryStatuses).optional(),
  deliveredWetMassKg: optionalNumber,
  massDryKg: optionalNumber,
  moistureContentPercent: optionalNumber,
}).superRefine((value, ctx) => {
  if (value.massDryKg != null && value.massDryKg < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["massDryKg"],
      message: "Dry mass must be >= 0",
    });
  }

  if (
    value.massDryKg != null &&
    value.deliveredWetMassKg != null &&
    value.massDryKg > value.deliveredWetMassKg
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["massDryKg"],
      message: "Dry mass must be less than or equal to wet mass",
    });
  }
});

/**
 * Schema for deleting a delivery
 */
export const deleteDeliverySchema = z.object({
  deliveryId: z.string().uuid("Invalid delivery ID"),
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
