"use server";

/**
 * Orders Server Actions
 * Server-side functions for order CRUD operations
 */

import { z } from "zod";
import { type Order, orders } from "@/db/schema";
import { generateNextCode } from "@/data-access/code-generator";
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
import { getUser } from "@/lib/auth/server";
import {
  createOrderSchema,
  deleteOrderSchema,
  updateOrderSchema,
  orderFilterSchema,
} from "@/schemas/orders";
import type { ActionResult } from "@/types/actions";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of orders with filtering
 */
export async function getOrdersFn(
  filters?: Partial<z.infer<typeof orderFilterSchema>>
): Promise<ActionResult<PaginatedOrders>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? orderFilterSchema.parse(filters)
      : undefined;
    const orders = await getOrdersData(user.id, validatedFilters);

    return { success: true, data: orders };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load orders",
    };
  }
}

/**
 * Get a single order by ID
 */
export async function getOrderByIdFn(
  orderId: string
): Promise<ActionResult<Order>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const order = await getOrderByIdData(user.id, orderId);
    return { success: true, data: order };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load order",
    };
  }
}

/**
 * Get an order with all its relations
 */
export async function getOrderWithRelationsFn(
  orderId: string
): Promise<ActionResult<OrderDetail>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const order = await getOrderWithRelationsData(user.id, orderId);
    return { success: true, data: order };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load order details",
    };
  }
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
      status: string;
      customerName: string | null;
    }>
  >
> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const orders = await getOrdersForSelectData(user.id, facilityId);
    return { success: true, data: orders };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load orders for select",
    };
  }
}

/**
 * Check if an order code is available
 */
export async function checkOrderCodeFn(
  code: string,
  excludeOrderId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isOrderCodeAvailableData(user.id, code, excludeOrderId);
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to check order code",
    };
  }
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
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createOrderSchema.parse(data);

    const code = validated.code || await generateNextCode("OR", orders, orders.code);

    const order = await createOrder(user.id, {
      code,
      facilityId: validated.facilityId,
      customerId: validated.customerId,
      customerLocationId: validated.customerLocationId,
      biocharProductId: validated.biocharProductId,
      orderDate: validated.orderDate,
      quantityKg: validated.quantityKg,
      packaging: validated.packaging,
      status: validated.status,
      value: validated.value ?? null,
      currency: validated.currency,
    });

    return { success: true, data: order };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create order",
    };
  }
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
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateOrderSchema.parse(data);

    const order = await updateOrder(user.id, validated.orderId, {
      code: validated.code,
      facilityId: validated.facilityId,
      customerId: validated.customerId,
      customerLocationId: validated.customerLocationId,
      biocharProductId: validated.biocharProductId,
      orderDate: validated.orderDate,
      quantityKg: validated.quantityKg,
      packaging: validated.packaging,
      status: validated.status,
      value: validated.value,
      currency: validated.currency,
    });

    return { success: true, data: order };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update order",
    };
  }
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
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteOrderSchema.parse(data);
    await deleteOrder(user.id, validated.orderId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete order",
    };
  }
}
