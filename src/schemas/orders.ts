/**
 * Orders Validation Schemas
 * Zod schemas for order forms, server actions, and filtering
 */

import { z } from "zod";
import {
  emptyToNull,
  MASS_INPUT_MAX_KG,
  MASS_MAX_KG_MESSAGE,
} from "@/schemas/helpers";
import { orderFulfillmentStatuses } from "@/lib/orders/fulfillment";

// ============================================
// Constants and Enums
// ============================================

/**
 * Packaging types
 */
export const packagingTypes = ["loose", "bagged"] as const;

export type PackagingType = (typeof packagingTypes)[number];

// ============================================
// Order Form Schema (Client-side validation)
// ============================================

/**
 * Schema for order form (client-side validation)
 * Used in OrderForm component for creating/editing orders
 */
export const orderFormSchema = z.object({
  // Required fields
  facilityId: z.string().min(1, "Please select a facility").uuid("Invalid facility"),
  customerId: z.string().min(1, "Please select a customer").uuid("Invalid customer"),
  customerLocationId: emptyToNull.or(z.string().uuid("Invalid customer location")).optional().nullable(),
  biocharProductId: z.string().min(1, "Please select a product bin").uuid("Invalid product bin selection"),
  orderDate: z.coerce.date({ error: "Order date is required" }),
  quantityKg: z
    .number({ error: "Quantity is required" })
    .min(0.01, "Quantity must be greater than 0")
    .max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE)
    .finite("Quantity must be a valid number"),
  packaging: z.enum(packagingTypes, { error: "Packaging type is required" }),

  // Optional fields
  value: z
    .number()
    .min(0, "Value must be non-negative")
    .finite()
    .optional()
    .nullable(),
  currency: z.string().max(10).default("TZS"),
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
  orderId: z.string().uuid("Invalid order ID"),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9-]+$/)
    .optional(),
  facilityId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  customerLocationId: z.string().uuid().optional().nullable(),
  biocharProductId: z.string().uuid().optional(),
  orderDate: z.coerce.date().optional(),
  quantityKg: z.number().min(0.01).max(MASS_INPUT_MAX_KG, MASS_MAX_KG_MESSAGE).finite().optional(),
  packaging: z.enum(packagingTypes).optional(),
  value: z.number().min(0).finite().optional().nullable(),
  currency: z.string().max(10).optional(),
});

/**
 * Schema for deleting an order
 */
export const deleteOrderSchema = z.object({
  orderId: z.string().uuid("Invalid order ID"),
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

/**
 * Schema for selecting an order (e.g., in dropdowns)
 */
export const orderSelectSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  orderDate: z.date(),
  customerName: z.string().optional(),
});

// ============================================
// Type Inference
// ============================================

export type OrderFormData = z.infer<typeof orderFormSchema>;
export type CreateOrderData = z.infer<typeof createOrderSchema>;
export type UpdateOrderData = z.infer<typeof updateOrderSchema>;
export type DeleteOrderData = z.infer<typeof deleteOrderSchema>;
export type OrderFilterData = z.infer<typeof orderFilterSchema>;
export type OrderSelectData = z.infer<typeof orderSelectSchema>;
