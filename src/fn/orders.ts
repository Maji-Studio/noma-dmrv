"use server";

/**
 * Orders Server Actions
 * Server-side functions for order CRUD operations
 */

import { z } from "zod";
import { type Order, orders } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import {
  createOrder,
  deleteOrder,
  getOrders as getOrdersData,
  getOrderById as getOrderByIdData,
  getOrderWithRelations as getOrderWithRelationsData,
  getOrdersForSelect as getOrdersForSelectData,
  isOrderCodeAvailable as isOrderCodeAvailableData,
  updateOrder,
  type PaginatedOrders,
  type OrderDetail,
} from "@/data-access/orders";
import {
  createOrderSchema,
  deleteOrderSchema,
  updateOrderSchema,
  orderFilterSchema,
} from "@/schemas/orders";
import type { ActionResult } from "@/types/actions";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { withAction } from "./with-action";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of orders with filtering
 */
export async function getOrdersFn(
  filters?: Partial<z.infer<typeof orderFilterSchema>>
): Promise<ActionResult<PaginatedOrders>> {
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? orderFilterSchema.parse(filters)
      : undefined;
    return getOrdersData(ctx, validatedFilters);
  }, { zodErrorPrefix: "Invalid filter parameters", fallbackMessage: "Failed to load orders" });
}

/**
 * Get a single order by ID
 */
const ORDER_CODE_MIN_LENGTH = 1;
const ORDER_CODE_MAX_LENGTH = 50;

const orderIdSchema = z.string().uuid("Invalid order ID");
const facilityIdSchema = z.string().uuid("Invalid facility ID");
const orderCodeSchema = z.string().min(ORDER_CODE_MIN_LENGTH, "Order code is required").max(ORDER_CODE_MAX_LENGTH);

export async function getOrderByIdFn(
  orderId: string
): Promise<ActionResult<Order>> {
  return withAction(async (ctx) => {
    const validatedId = orderIdSchema.parse(orderId);
    return getOrderByIdData(ctx, validatedId);
  }, { fallbackMessage: "Failed to load order" });
}

/**
 * Get an order with all its relations
 */
export async function getOrderWithRelationsFn(
  orderId: string
): Promise<ActionResult<OrderDetail>> {
  return withAction(async (ctx) => {
    const validatedId = orderIdSchema.parse(orderId);
    return getOrderWithRelationsData(ctx, validatedId);
  }, { fallbackMessage: "Failed to load order details" });
}

/**
 * Get orders for dropdown selection
 */
export async function getOrdersForSelectFn(
  facilityId?: string
): Promise<
  ActionResult<
    Array<{
      id: string;
      code: string;
      orderDate: Date;
      customerName: string | null;
      biocharProductCode: string | null;
      quantityKg: number;
      destinationGpsLatitude: number | null;
      destinationGpsLongitude: number | null;
      destinationDistanceKm: number | null;
      destinationDistanceSource: DistanceSourceValue | null;
    }>
  >
> {
  return withAction(async (ctx) => {
    const validatedFacilityId = facilityId
      ? facilityIdSchema.parse(facilityId)
      : undefined;
    return getOrdersForSelectData(ctx, validatedFacilityId);
  }, { fallbackMessage: "Failed to load orders for select" });
}

/**
 * Check if an order code is available
 */
export async function checkOrderCodeFn(
  code: string,
  excludeOrderId?: string
): Promise<ActionResult<{ available: boolean }>> {
  return withAction(async (ctx) => {
    const validatedCode = orderCodeSchema.parse(code);
    const validatedExcludeId = excludeOrderId
      ? orderIdSchema.parse(excludeOrderId)
      : undefined;
    const available = await isOrderCodeAvailableData(ctx, validatedCode, validatedExcludeId);
    return { available };
  }, { fallbackMessage: "Failed to check order code" });
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new order
 */
export async function createOrderFn(
  data: z.infer<typeof createOrderSchema>
): Promise<ActionResult<Order>> {
  return withAction(async (ctx) => {
    const validated = createOrderSchema.parse(data);

    return withAutoCode(
      ctx,
      "OR",
      orders,
      orders.code,
      undefined,
      (code) =>
        createOrder(ctx, {
          code,
          facilityId: validated.facilityId,
          customerId: validated.customerId,
          customerLocationId: validated.customerLocationId,
          biocharProductId: validated.biocharProductId,
          orderDate: validated.orderDate,
          quantityKg: validated.quantityKg,
          packaging: validated.packaging,
          value: validated.value ?? null,
          currency: validated.currency,
        }),
      CODE_CONFLICT_MESSAGES.order,
    );
  }, { fallbackMessage: "Failed to create order" });
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing order
 */
export async function updateOrderFn(
  data: z.infer<typeof updateOrderSchema>
): Promise<ActionResult<Order>> {
  return withAction(async (ctx) => {
    const validated = updateOrderSchema.parse(data);

    return updateOrder(ctx, validated.orderId, {
      code: validated.code,
      facilityId: validated.facilityId,
      customerId: validated.customerId,
      customerLocationId: validated.customerLocationId,
      biocharProductId: validated.biocharProductId,
      orderDate: validated.orderDate,
      quantityKg: validated.quantityKg,
      packaging: validated.packaging,
      value: validated.value,
      currency: validated.currency,
    });
  }, { fallbackMessage: "Failed to update order" });
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete an order
 */
export async function deleteOrderFn(
  data: z.infer<typeof deleteOrderSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {
    const validated = deleteOrderSchema.parse(data);
    await deleteOrder(ctx, validated.orderId);
  }, { fallbackMessage: "Failed to delete order" });
}
