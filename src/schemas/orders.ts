/**
 * Orders Validation Schemas
 * Zod schemas for order forms, server actions, and filtering
 */

import { orderFulfillmentStatuses } from "@/lib/orders/fulfillment";
import {
  calendarDateSchema,
  expectedVersionSchema,
  MASS_KG_INPUT_STEP,
  MASS_MIN_KG_MESSAGE,
  requiredPositiveMassKgSchema,
} from "@/schemas/helpers";
import { z } from "zod";

// ============================================
// Constants and Enums
// ============================================

/**
 * Packaging types
 */
export const packagingTypes = ["loose", "bagged"] as const;

export type PackagingType = (typeof packagingTypes)[number];

export const orderCustomerLocationIdSchema = z.uuid({
  error: (issue) => issue.input == null || issue.input === ""
    ? "Select a customer location."
    : "Choose a valid customer location.",
}).toLowerCase();

export const orderQuantityKgSchema = requiredPositiveMassKgSchema(
  "Quantity is required",
  "Quantity must be a number",
  "Quantity must be greater than 0",
  { value: MASS_KG_INPUT_STEP, message: MASS_MIN_KG_MESSAGE },
);

// ============================================
// Order Form Schema (Client-side validation)
// ============================================

/**
 * Schema for order form (client-side validation)
 * Used in OrderForm component for creating/editing orders
 */
export const orderFormSchema = z.object({
  // Required fields
  facilityId: z.string().min(1, "Select a facility.").uuid("Choose a valid facility."),
  customerId: z.string().min(1, "Select a customer.").uuid("Choose a valid customer."),
  customerLocationId: orderCustomerLocationIdSchema,
  formulationId: z.string().min(1, "Select a formulation.").pipe(z.uuid("Choose a valid formulation.")),
  orderDate: calendarDateSchema(),
  quantityKg: orderQuantityKgSchema,
  packaging: z.enum(packagingTypes, { error: "Packaging type is required" }),
});

// ============================================
// Server Action Schemas
// ============================================

/**
 * Schema for creating an order (server action)
 * Same as form schema - all required fields must be present
 */
export const createOrderSchema = orderFormSchema;

/**
 * Schema for updating an order (server action)
 * All fields optional except orderId
 */
export const updateOrderSchema = z.object({
  expectedVersion: expectedVersionSchema,
  orderId: z.string().uuid("Choose a valid order."),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  facilityId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  customerLocationId: orderCustomerLocationIdSchema.optional(),
  formulationId: z.uuid().optional(),
  orderDate: calendarDateSchema().optional(),
  quantityKg: orderQuantityKgSchema.optional(),
  packaging: z.enum(packagingTypes).optional(),
});

/**
 * Schema for deleting an order
 */
export const deleteOrderSchema = z.object({
  expectedVersion: expectedVersionSchema,
  orderId: z.string().uuid("Choose a valid order."),
});

// ============================================
// Filter/Query Schemas
// ============================================

/**
 * Schema for filtering orders in list views
 * Used for search, pagination, and filtering
 */
export const orderFilterSchema = z.object({
  // Text search across code
  search: z
    .string()
    .max(255, "Search query must be less than 255 characters")
    .optional(),

  // Filter by facility
  facilityId: z.string().uuid().optional(),

  // Filter by customer
  customerId: z.string().uuid().optional(),

  // Filter by derived fulfillment status (computed from deliveries, not stored)
  status: z.enum(orderFulfillmentStatuses).optional(),

  // Filter by date range
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),

  // Pagination
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),

  // Sorting
  sortBy: z
    .enum(["code", "orderDate", "quantityKg", "createdAt", "updatedAt"])
    .default("orderDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ============================================
// Type Inference
// ============================================

export type OrderFormData = z.infer<typeof orderFormSchema>;
export type CreateOrderData = z.infer<typeof createOrderSchema>;
export type UpdateOrderData = z.infer<typeof updateOrderSchema>;
export type OrderFilterData = z.infer<typeof orderFilterSchema>;

export type DeleteOrderData = z.infer<typeof deleteOrderSchema>;
