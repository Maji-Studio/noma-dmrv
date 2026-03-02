"use server";

/**
 * Deliveries Server Actions
 * Server-side functions for delivery CRUD operations
 */

import { z } from "zod";
import { type Delivery, deliveries as deliveriesTable } from "@/db/schema";
import { generateNextCode } from "@/data-access/code-generator";
import {
  createDelivery,
  deleteDelivery,
  getDeliveries as getDeliveriesData,
  getDeliveryById as getDeliveryByIdData,
  getDeliveryWithRelations as getDeliveryWithRelationsData,
  getDeliveriesForSelect as getDeliveriesForSelectData,
  getDeliveryStats as getDeliveryStatsData,
  isDeliveryCodeAvailable as isDeliveryCodeAvailableData,
  updateDelivery,
  type PaginatedDeliveries,
  type DeliveryDetail,
  type DeliveryStats,
} from "@/data-access/deliveries";
import { getUser } from "@/lib/auth/server";
import {
  createDeliverySchema,
  deleteDeliverySchema,
  updateDeliverySchema,
  deliveryFilterSchema,
} from "@/schemas/deliveries";
import type { ActionResult } from "@/types/actions";

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of deliveries with filtering
 */
export async function getDeliveriesFn(
  filters?: Partial<z.infer<typeof deliveryFilterSchema>>
): Promise<ActionResult<PaginatedDeliveries>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? deliveryFilterSchema.parse(filters)
      : undefined;
    const deliveries = await getDeliveriesData(user.id, validatedFilters);

    return { success: true, data: deliveries };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load deliveries",
    };
  }
}

/**
 * Get a single delivery by ID
 */
export async function getDeliveryByIdFn(
  deliveryId: string
): Promise<ActionResult<Delivery>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const delivery = await getDeliveryByIdData(user.id, deliveryId);
    return { success: true, data: delivery };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load delivery",
    };
  }
}

/**
 * Get a delivery with all its relations
 */
export async function getDeliveryWithRelationsFn(
  deliveryId: string
): Promise<ActionResult<DeliveryDetail>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const delivery = await getDeliveryWithRelationsData(user.id, deliveryId);
    return { success: true, data: delivery };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load delivery details",
    };
  }
}

/**
 * Get delivery statistics
 */
export async function getDeliveryStatsFn(
  filters?: { facilityId?: string; fromDate?: Date; toDate?: Date }
): Promise<ActionResult<DeliveryStats>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const stats = await getDeliveryStatsData(user.id, filters);
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load delivery stats",
    };
  }
}

/**
 * Get deliveries for dropdown selection
 */
export async function getDeliveriesForSelectFn(
  orderId?: string
): Promise<
  ActionResult<
    Array<{
      id: string;
      code: string;
      deliveryDate: Date;
      status: string;
      orderCode: string | null;
    }>
  >
> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const deliveries = await getDeliveriesForSelectData(user.id, orderId);
    return { success: true, data: deliveries };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load deliveries for select",
    };
  }
}

/**
 * Check if a delivery code is available
 */
export async function checkDeliveryCodeFn(
  code: string,
  excludeDeliveryId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isDeliveryCodeAvailableData(
      user.id,
      code,
      excludeDeliveryId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to check delivery code",
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new delivery
 */
export async function createDeliveryFn(
  data: z.infer<typeof createDeliverySchema>
): Promise<ActionResult<Delivery>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    // Auto-generate code before validation if empty
    const code = data.code || await generateNextCode("DL", deliveriesTable, deliveriesTable.code);
    const validated = createDeliverySchema.parse({ ...data, code });

    const delivery = await createDelivery(user.id, {
      code,
      orderId: validated.orderId,
      facilityId: validated.facilityId,
      deliveryDate: validated.deliveryDate,
      biocharProductId: validated.biocharProductId ?? null,
      driverId: validated.driverId ?? null,
      vehicleId: validated.vehicleId ?? null,
      status: validated.status,
      deliveredWetMassKg: validated.deliveredWetMassKg ?? null,
      massDryKg: validated.massDryKg ?? null,
      moistureContentPercent: validated.moistureContentPercent ?? null,
    });

    return { success: true, data: delivery };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create delivery",
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing delivery
 */
export async function updateDeliveryFn(
  data: z.infer<typeof updateDeliverySchema>
): Promise<ActionResult<Delivery>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateDeliverySchema.parse(data);

    const delivery = await updateDelivery(user.id, validated.deliveryId, {
      code: validated.code,
      orderId: validated.orderId,
      facilityId: validated.facilityId,
      deliveryDate: validated.deliveryDate,
      biocharProductId: validated.biocharProductId,
      driverId: validated.driverId,
      vehicleId: validated.vehicleId,
      status: validated.status,
      deliveredWetMassKg: validated.deliveredWetMassKg,
      massDryKg: validated.massDryKg,
      moistureContentPercent: validated.moistureContentPercent,
    });

    return { success: true, data: delivery };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update delivery",
    };
  }
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a delivery
 */
export async function deleteDeliveryFn(
  data: z.infer<typeof deleteDeliverySchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteDeliverySchema.parse(data);
    await deleteDelivery(user.id, validated.deliveryId);

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
      error: error instanceof Error ? error.message : "Failed to delete delivery",
    };
  }
}
