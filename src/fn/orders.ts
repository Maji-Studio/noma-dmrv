"use server";

/**
 * Orders Server Actions
 * Server-side functions for order CRUD operations
 */

import { z } from "zod";
import { type Order, orders } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
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
  return withAction(async (userId) => {
    const validatedFilters = filters
      ? orderFilterSchema.parse(filters)
      : undefined;
    return getOrdersData(userId, validatedFilters);
  }, { zodErrorPrefix: "Invalid filter parameters", fallbackMessage: "Failed to load orders" });
}

/**
 * Get a single order by ID
 */
export async function getOrderByIdFn(
  orderId: string
): Promise<ActionResult<Order>> {
  return withAction(async (userId) => {
    return getOrderByIdData(userId, orderId);
  }, { fallbackMessage: "Failed to load order" });
}

/**
 * Get an order with all its relations
 */
export async function getOrderWithRelationsFn(
  orderId: string
): Promise<ActionResult<OrderDetail>> {
  return withAction(async (userId) => {
    return getOrderWithRelationsData(userId, orderId);
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
    }>
  >
> {
  return withAction(async (userId) => {
    return getOrdersForSelectData(userId, facilityId);
  }, { fallbackMessage: "Failed to load orders for select" });
}

/**
 * Check if an order code is available
 */
export async function checkOrderCodeFn(
  code: string,
  excludeOrderId?: string
): Promise<ActionResult<{ available: boolean }>> {
  return withAction(async (userId) => {
    const available = await isOrderCodeAvailableData(userId, code, excludeOrderId);
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
  return withAction(async (userId) => {
    const validated = createOrderSchema.parse(data);

    return withAutoCode(
      "OR",
      orders,
      orders.code,
      undefined,
      (code) =>
        createOrder(userId, {
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
        })
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
  return withAction(async (userId) => {
    const validated = updateOrderSchema.parse(data);

    return updateOrder(userId, validated.orderId, {
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
  return withAction(async (userId) => {
    const validated = deleteOrderSchema.parse(data);
    await deleteOrder(userId, validated.orderId);
  }, { fallbackMessage: "Failed to delete order" });
}
