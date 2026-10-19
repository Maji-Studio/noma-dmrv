"use server";

/**
 * Orders Server Actions
 * Server-side functions for order CRUD operations
 */

import {
  getOrders as getOrdersData,
  getOrdersForSelect as getOrdersForSelectData,
  type PaginatedOrders,
} from "@/data-access/orders";
import { requireOrgFacility } from "@/data-access/utils";
import { type Order } from "@/db/schema";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import {
  createOrderSchema,
  deleteOrderSchema,
  orderFilterSchema,
  updateOrderSchema,
} from "@/schemas/orders";
import type { ActionResult } from "@/types/actions";
import { z } from "zod";
import { recordOrder, updateOrder, deleteOrder } from "@/lib/operations/orders";
import { runOperationInProcess } from "@/lib/operations/runner";
import { withAction } from "./with-action";
import { getOrderById, getOrderWithRelationsById, type OrderWithRelations } from "@/data-access/orders";
import { uuidSchema } from "@/schemas/helpers";

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
      formulationName: string | null;
      formulationId: string;
      quantityKg: number;
      destinationName: string | null;
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

    return runOperationInProcess(recordOrder, ctx, validated);
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

    return runOperationInProcess(updateOrder, ctx, validated);
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
    await runOperationInProcess(deleteOrder, ctx, validated);
  }, { fallbackMessage: "Failed to delete order" });
}

export async function getOrderByIdFn(id: string) {
  return withAction((ctx) => getOrderById(ctx, uuidSchema().parse(id)));
}

/** One order in the list row shape, archived included: the `?order=` deep link. */
export async function getOrderWithRelationsFn(id: string): Promise<ActionResult<OrderWithRelations>> {
  return withAction((ctx) => getOrderWithRelationsById(ctx, uuidSchema().parse(id)));
}
