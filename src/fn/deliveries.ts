"use server";

/**
 * Deliveries Server Actions
 * Server-side functions for delivery CRUD operations
 */

import { z } from "zod";
import { type Delivery, deliveries as deliveriesTable } from "@/db/schema";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import {
  createDelivery,
  deleteDelivery,
  getDeliveries as getDeliveriesData,
  getDeliveryById as getDeliveryByIdData,
  getDeliveryWithRelations as getDeliveryWithRelationsData,
  getDeliveriesForSelect as getDeliveriesForSelectData,
  isDeliveryCodeAvailable as isDeliveryCodeAvailableData,
  updateDelivery,
  type PaginatedDeliveries,
  type DeliveryDetail,
} from "@/data-access/deliveries";
import {
  getDeliveryStats as getDeliveryStatsData,
  type DeliveryStats,
} from "@/data-access/delivery-stats";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createDeliverySchema,
  deleteDeliverySchema,
  resolveDeliveryDistanceSource,
  updateDeliverySchema,
  deliveryFilterSchema,
} from "@/schemas/deliveries";
import type { ActionResult } from "@/types/actions";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

function deliveryActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "delivery action failed",
    context: { op },
  });
}

const deliveryStatsFilterSchema = z.object({
  facilityId: z.string().uuid().optional(),
  creditBatchId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
}).optional();

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
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? deliveryFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const deliveries = await getDeliveriesData(ctx, validatedFilters);

    return { success: true, data: deliveries };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to load deliveries",
        "delivery:list",
      ),
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
    const ctx = await requireOrgContext();

    const delivery = await getDeliveryByIdData(ctx, deliveryId);
    return { success: true, data: delivery };
  } catch (error) {
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to load delivery",
        "delivery:get",
      ),
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
    const ctx = await requireOrgContext();

    const delivery = await getDeliveryWithRelationsData(ctx, deliveryId);
    return { success: true, data: delivery };
  } catch (error) {
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to load delivery details",
        "delivery:detail",
      ),
    };
  }
}

/**
 * Get delivery statistics
 */
export async function getDeliveryStatsFn(
  filters?: {
    facilityId?: string;
    creditBatchId?: string;
    fromDate?: Date;
    toDate?: Date;
  }
): Promise<ActionResult<DeliveryStats>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFilters = deliveryStatsFilterSchema.parse(filters);
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const stats = await getDeliveryStatsData(ctx, validatedFilters);
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to load delivery stats",
        "delivery:stats",
      ),
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
    const ctx = await requireOrgContext();

    const deliveries = await getDeliveriesForSelectData(ctx, orderId);
    return { success: true, data: deliveries };
  } catch (error) {
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to load deliveries for select",
        "delivery:select-options",
      ),
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
    const ctx = await requireOrgContext();

    const available = await isDeliveryCodeAvailableData(
      ctx,
      code,
      excludeDeliveryId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to check delivery code",
        "delivery:check-code",
      ),
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
    const ctx = await requireOrgContext();

    const delivery = await withAutoCode(
      ctx,
      "DL",
      deliveriesTable,
      deliveriesTable.code,
      data.code,
      async (code) => {
        const validated = createDeliverySchema.parse({ ...data, code });
        return createDelivery(ctx, {
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
          distanceKmOverride: validated.distanceKmOverride ?? null,
          distanceSource: resolveDeliveryDistanceSource(
            validated.distanceKmOverride ?? null,
            validated.distanceSource,
          ),
          distanceNote: validated.distanceNote || null,
          tripType: validated.tripType ?? undefined,
        });
      },
      CODE_CONFLICT_MESSAGES.delivery,
    );

    return { success: true, data: delivery };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to create delivery",
        "delivery:create",
      ),
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
    const ctx = await requireOrgContext();

    const validated = updateDeliverySchema.parse(data);

    const delivery = await updateDelivery(ctx, validated.deliveryId, {
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
      distanceKmOverride: validated.distanceKmOverride,
      distanceSource: resolveDeliveryDistanceSource(
        validated.distanceKmOverride,
        validated.distanceSource,
      ),
      distanceNote: validated.distanceNote || null,
      tripType: validated.tripType ?? undefined,
    });

    return { success: true, data: delivery };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to update delivery",
        "delivery:update",
      ),
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
    const ctx = await requireOrgContext();

    const validated = deleteDeliverySchema.parse(data);
    await deleteDelivery(ctx, validated.deliveryId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    return {
      success: false,
      error: deliveryActionError(
        error,
        "Failed to delete delivery",
        "delivery:delete",
      ),
    };
  }
}
