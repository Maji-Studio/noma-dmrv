"use server";

/**
 * Feedstock Deliveries Server Actions
 * Server-side functions for feedstock delivery CRUD operations
 */

import { z } from "zod";
import { feedstockDeliveries } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import {
  createFeedstockDelivery,
  deleteFeedstockDelivery,
  getFeedstockDeliveries as getFeedstockDeliveriesData,
  getFeedstockDeliveryById as getFeedstockDeliveryByIdData,
  getFeedstockDeliveryStats as getFeedstockDeliveryStatsData,
  isFeedstockDeliveryCodeAvailable as isFeedstockDeliveryCodeAvailableData,
  getFeedstockDeliveryOptions as getFeedstockDeliveryOptionsData,
  updateFeedstockDelivery,
  type PaginatedFeedstockDeliveries,
  type FeedstockDeliveryWithRelations,
  type FeedstockDeliveryStats,
} from "@/data-access/feedstock-deliveries";
import { getUser } from "@/lib/auth/server";
import {
  createFeedstockDeliverySchema,
  deleteFeedstockDeliverySchema,
  updateFeedstockDeliverySchema,
  feedstockDeliveryFilterSchema,
} from "@/schemas/feedstock-deliveries";
import type { ActionResult } from "@/types/actions";

// ============================================
// Feedstock Delivery List/Query Operations
// ============================================

/**
 * Get paginated list of feedstock deliveries with filtering
 */
export async function getFeedstockDeliveriesFn(
  filters?: Partial<z.infer<typeof feedstockDeliveryFilterSchema>>
): Promise<ActionResult<PaginatedFeedstockDeliveries>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? feedstockDeliveryFilterSchema.parse(filters)
      : undefined;
    const deliveries = await getFeedstockDeliveriesData(user.id, validatedFilters);

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
      error:
        error instanceof Error ? error.message : "Failed to load feedstock deliveries",
    };
  }
}

/**
 * Get a single feedstock delivery by ID
 */
export async function getFeedstockDeliveryByIdFn(
  deliveryId: string
): Promise<ActionResult<FeedstockDeliveryWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const delivery = await getFeedstockDeliveryByIdData(user.id, deliveryId);
    return { success: true, data: delivery };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load feedstock delivery",
    };
  }
}

/**
 * Get feedstock delivery statistics
 */
export async function getFeedstockDeliveryStatsFn(
  facilityId?: string
): Promise<ActionResult<FeedstockDeliveryStats>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const stats = await getFeedstockDeliveryStatsData(user.id, facilityId);
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load feedstock delivery stats",
    };
  }
}

/**
 * Get feedstock delivery options for dropdowns
 */
export async function getFeedstockDeliveryOptionsFn(): Promise<
  ActionResult<Array<{ id: string; code: string; deliveryDate: Date; supplierName: string | null }>>
> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const options = await getFeedstockDeliveryOptionsData(user.id);
    return { success: true, data: options };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load feedstock delivery options",
    };
  }
}

/**
 * Check if a feedstock delivery code is available
 */
export async function checkFeedstockDeliveryCodeFn(
  code: string,
  excludeDeliveryId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isFeedstockDeliveryCodeAvailableData(
      user.id,
      code,
      excludeDeliveryId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check feedstock delivery code",
    };
  }
}

// ============================================
// Feedstock Delivery Create Operations
// ============================================

/**
 * Create a new feedstock delivery
 */
export async function createFeedstockDeliveryFn(
  data: z.infer<typeof createFeedstockDeliverySchema>
): Promise<ActionResult<FeedstockDeliveryWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = createFeedstockDeliverySchema.parse(data);

    const delivery = await withAutoCode(
      "FD",
      feedstockDeliveries,
      feedstockDeliveries.code,
      undefined,
      (code) =>
        createFeedstockDelivery(user.id, {
          code,
          facilityId: validated.facilityId,
          deliveryDate: validated.deliveryDate instanceof Date
            ? validated.deliveryDate
            : new Date(validated.deliveryDate),
          supplierId: validated.supplierId,
          driverId: validated.driverId || null,
          vehicleId: validated.vehicleId || null,
          gpsLatitude: validated.gpsLatitude ?? null,
          gpsLongitude: validated.gpsLongitude ?? null,
          feedstockTypeId: validated.feedstockTypeId || null,
          wetMassKg: validated.wetMassKg ?? null,
          moisturePercent: validated.moisturePercent ?? null,
          notes: validated.notes || null,
        })
    );

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
      error:
        error instanceof Error ? error.message : "Failed to create feedstock delivery",
    };
  }
}

// ============================================
// Feedstock Delivery Update Operations
// ============================================

/**
 * Update an existing feedstock delivery
 */
export async function updateFeedstockDeliveryFn(
  data: z.infer<typeof updateFeedstockDeliverySchema>
): Promise<ActionResult<FeedstockDeliveryWithRelations>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateFeedstockDeliverySchema.parse(data);

    const delivery = await updateFeedstockDelivery(user.id, validated.deliveryId, {
      code: validated.code,
      facilityId: validated.facilityId,
      deliveryDate: validated.deliveryDate instanceof Date
        ? validated.deliveryDate
        : validated.deliveryDate
          ? new Date(validated.deliveryDate)
          : undefined,
      supplierId: validated.supplierId,
      driverId: validated.driverId,
      vehicleId: validated.vehicleId,
      gpsLatitude: validated.gpsLatitude,
      gpsLongitude: validated.gpsLongitude,
      feedstockTypeId: validated.feedstockTypeId,
      wetMassKg: validated.wetMassKg,
      moisturePercent: validated.moisturePercent,
      notes: validated.notes,
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
      error:
        error instanceof Error ? error.message : "Failed to update feedstock delivery",
    };
  }
}

// ============================================
// Feedstock Delivery Delete Operations
// ============================================

/**
 * Delete a feedstock delivery
 */
export async function deleteFeedstockDeliveryFn(
  data: z.infer<typeof deleteFeedstockDeliverySchema>
): Promise<ActionResult<void>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteFeedstockDeliverySchema.parse(data);
    await deleteFeedstockDelivery(user.id, validated.deliveryId);

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
      error:
        error instanceof Error ? error.message : "Failed to delete feedstock delivery",
    };
  }
}
