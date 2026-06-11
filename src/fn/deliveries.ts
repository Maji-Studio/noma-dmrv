"use server";

/**
 * Deliveries Server Actions
 * Server-side functions for delivery CRUD operations
 */

import { z } from "zod";
import { type Delivery, deliveries as deliveriesTable } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
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
import { syncBiocharProductTransportLeg } from "@/data-access/transport-legs";
import { getUser } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import {
  createDeliverySchema,
  deleteDeliverySchema,
  updateDeliverySchema,
  deliveryFilterSchema,
} from "@/schemas/deliveries";
import type { ActionResult } from "@/types/actions";

// A biochar product's distribution transport leg is auto-derived from the
// aggregate of its deliveries (customer-location distance + delivered mass), so
// any delivery write must resync the affected product(s). Reassignments and
// deletes resync both the old and new product. Dedupes and skips nulls.
async function resyncBiocharLegs(
  userId: string,
  biocharProductIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [
    ...new Set(
      biocharProductIds.filter((id): id is string => Boolean(id)),
    ),
  ];
  // The resync runs AFTER the delivery write has committed, so a failure here
  // must not surface as a failed delivery mutation. The derived leg is
  // self-healing — the next delivery write for the product recomputes it via
  // the idempotent upsert — so we log and move on rather than throw.
  try {
    await Promise.all(
      ids.map((id) => syncBiocharProductTransportLeg(userId, id)),
    );
  } catch (error) {
    logger.warn(
      {
        userId,
        biocharProductIds: ids,
        err: error instanceof Error ? error.message : String(error),
      },
      "biochar transport leg resync failed; leg may be stale until next delivery write",
    );
  }
}

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

    const delivery = await withAutoCode(
      "DL",
      deliveriesTable,
      deliveriesTable.code,
      data.code,
      async (code) => {
        const validated = createDeliverySchema.parse({ ...data, code });
        return createDelivery(user.id, {
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
          truckMassOnArrivalKg: validated.truckMassOnArrivalKg ?? null,
          truckMassOnDepartureKg: validated.truckMassOnDepartureKg ?? null,
          distanceKmOverride: validated.distanceKmOverride ?? null,
          distanceNote: validated.distanceNote || null,
        });
      }
    );

    await resyncBiocharLegs(user.id, [delivery.biocharProductId]);

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

    // Capture the prior product so a product reassignment resyncs both.
    const previous = await getDeliveryByIdData(user.id, validated.deliveryId);

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
      truckMassOnArrivalKg: validated.truckMassOnArrivalKg,
      truckMassOnDepartureKg: validated.truckMassOnDepartureKg,
      distanceKmOverride: validated.distanceKmOverride,
      distanceNote: validated.distanceNote || null,
    });

    await resyncBiocharLegs(user.id, [
      previous?.biocharProductId,
      delivery.biocharProductId,
    ]);

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
    const previous = await getDeliveryByIdData(user.id, validated.deliveryId);
    await deleteDelivery(user.id, validated.deliveryId);

    await resyncBiocharLegs(user.id, [previous?.biocharProductId]);

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
