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
import { requireOrgFacility } from "@/data-access/utils";
import {
  createOrder,
  deleteOrder,
  getOrders as getOrdersData,
  getOrdersForSelect as getOrdersForSelectData,
  updateOrder,
  type PaginatedOrders,
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
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    return getOrdersData(ctx, validatedFilters);
  }, { zodErrorPrefix: "Invalid filter parameters", fallbackMessage: "Failed to load orders" });
}

const facilityIdSchema = z.string().uuid("Invalid facility ID");

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
    if (validatedFacilityId) {
      await requireOrgFacility(ctx, validatedFacilityId);
    }
    return getOrdersForSelectData(ctx, validatedFacilityId);
  }, { fallbackMessage: "Failed to load orders for select" });
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
