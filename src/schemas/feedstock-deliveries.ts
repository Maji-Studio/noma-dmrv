/**
 * Feedstock Delivery Validation Schemas
 * Zod schemas for feedstock delivery forms, server actions, and filtering
 */

import { z } from "zod";
import { emptyToNull } from "./helpers";

// ============================================
// GPS Coordinate Validation (Optional for deliveries)
// ============================================

/**
 * GPS latitude validation (-90 to 90) - Optional for deliveries
 */
const optionalLatitudeSchema = z
  .number()
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90")
  .optional()
  .nullable();

/**
 * GPS longitude validation (-180 to 180) - Optional for deliveries
 */
const optionalLongitudeSchema = z
  .number()
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180")
  .optional()
  .nullable();

// ============================================
// Feedstock Delivery Form Schema (Client-side validation)
// ============================================

/**
 * Schema for feedstock delivery form (client-side validation)
 * Used in FeedstockDeliveryForm component for creating/editing deliveries
 */
export const feedstockDeliveryFormSchema = z.object({
  // Required fields
  facilityId: z.string().min(1, "Please select a facility").uuid("Please select a valid facility"),
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
  supplierId: z.string().min(1, "Please select a supplier").uuid("Please select a valid supplier"),

  // Optional transport fields
  driverId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  vehicleId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  gpsLatitude: z.union([
    z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90"),
    z.string().transform((val, ctx) => {
      if (val === "") return null;
      const n = parseFloat(val);
      if (isNaN(n)) return null;
      if (n < -90 || n > 90) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Latitude must be between -90 and 90" });
        return z.NEVER;
      }
      return n;
    }),
    z.null(),
  ]).optional().nullable(),
  gpsLongitude: z.union([
    z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180"),
    z.string().transform((val, ctx) => {
      if (val === "") return null;
      const n = parseFloat(val);
      if (isNaN(n)) return null;
      if (n < -180 || n > 180) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Longitude must be between -180 and 180" });
        return z.NEVER;
      }
      return n;
    }),
    z.null(),
  ]).optional().nullable(),

  // Feedstock details
  feedstockTypeId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  storageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  wetMassKg: z.union([
    z.number().min(0, "Wet mass must be positive"),
    z.string().transform((val, ctx) => {
      if (val === "") return null;
      const n = parseFloat(val);
      if (isNaN(n)) return null;
      if (n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Wet mass must be positive" });
        return z.NEVER;
      }
      return n;
    }),
    z.null(),
  ]).optional().nullable(),
  moisturePercent: z.union([
    z.number().min(0, "Moisture must be between 0 and 100").max(100, "Moisture must be between 0 and 100"),
    z.string().transform((val, ctx) => {
      if (val === "") return null;
      const n = parseFloat(val);
      if (isNaN(n)) return null;
      if (n < 0 || n > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Moisture must be between 0 and 100" });
        return z.NEVER;
      }
      return n;
    }),
    z.null(),
  ]).optional().nullable(),

  // Documentation
  notes: z
    .string()
    .max(2000, "Notes must be less than 2000 characters")
    .optional()
    .or(z.literal("")),
});

// ============================================
// Server Action Schemas - Feedstock Delivery
// ============================================

/**
 * Schema for creating a feedstock delivery (server action)
 * Same as form schema - all required fields must be present
 */
export const createFeedstockDeliverySchema = feedstockDeliveryFormSchema;

/**
 * Schema for updating a feedstock delivery (server action)
 * All fields optional except deliveryId
 */
export const updateFeedstockDeliverySchema = z.object({
  deliveryId: z.string().uuid("Invalid delivery ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
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
  driverId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  vehicleId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  gpsLatitude: optionalLatitudeSchema,
  gpsLongitude: optionalLongitudeSchema,
  feedstockTypeId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  storageLocationId: emptyToNull.or(z.string().uuid()).nullable().optional(),
  wetMassKg: z.number().min(0).optional().nullable(),
  moisturePercent: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable().or(z.literal("")),
});

/**
 * Schema for deleting a feedstock delivery
 */
export const deleteFeedstockDeliverySchema = z.object({
  deliveryId: z.string().uuid("Invalid delivery ID"),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering feedstock deliveries in list views
 * Used for search, pagination, and filtering
 */
export const feedstockDeliveryFilterSchema = z.object({
  // Text search across code, supplier name
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter by supplier
  supplierId: z.string().uuid().optional(),

  // Filter by feedstock type
  feedstockTypeId: z.string().uuid().optional(),

  // Filter by status
  status: z.enum(["missing_data", "complete"]).optional(),

  // Date range filter
  startDate: z.date().optional(),
  endDate: z.date().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "deliveryDate", "wetMassKg", "createdAt", "updatedAt"])
    .default("deliveryDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Schema for selecting a feedstock delivery (e.g., in dropdowns)
 */
export const feedstockDeliverySelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  deliveryDate: z.date(),
  supplierName: z.string().optional().nullable(),
});

// ============================================
// Type Inference
// ============================================

export type FeedstockDeliveryFormData = z.infer<typeof feedstockDeliveryFormSchema>;
export type CreateFeedstockDeliveryData = z.infer<typeof createFeedstockDeliverySchema>;
export type UpdateFeedstockDeliveryData = z.infer<typeof updateFeedstockDeliverySchema>;
export type DeleteFeedstockDeliveryData = z.infer<typeof deleteFeedstockDeliverySchema>;
export type FeedstockDeliveryFilterData = z.infer<typeof feedstockDeliveryFilterSchema>;
export type FeedstockDeliverySelectData = z.infer<typeof feedstockDeliverySelectSchema>;
