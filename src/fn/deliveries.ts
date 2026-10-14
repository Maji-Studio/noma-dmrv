"use server";

/**
 * Deliveries Server Actions
 * Server-side functions for delivery CRUD operations
 */

import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import {
  createDelivery,
  deleteDelivery,
  getDeliveries as getDeliveriesData,
  getDeliveryWithRelations as getDeliveryWithRelationsData,
  type CreatedDelivery,
  type DeliveryDetail,
  type PaginatedDeliveries,
  type UpdatedDelivery,
} from "@/data-access/deliveries";
import { updateDelivery } from "@/lib/operations/deliveries";
import {
  getDeliveryStats as getDeliveryStatsData,
  type DeliveryStats,
} from "@/data-access/delivery-stats";
import { requireOrgFacility } from "@/data-access/utils";
import { deliveries as deliveriesTable, type Delivery } from "@/db/schema";
import {
  createDeliverySchema,
  deleteDeliverySchema,
  deliveryFilterSchema,
  resolveDeliveryDistanceSource,
  updateDeliverySchema,
} from "@/schemas/deliveries";
import { withAction } from "./with-action";
import type { ActionResult } from "@/types/actions";
import { z } from "zod";

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
  return withAction(async (ctx) => {
    const validatedFilters = filters
      ? deliveryFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const deliveries = await getDeliveriesData(ctx, validatedFilters);

    return deliveries;
  }, {
    fallbackMessage: "Failed to load deliveries",
    zodErrorPrefix: "Invalid filter parameters",
    log: { message: "delivery action failed", context: { op: "delivery:list" } },
  });
}

/**
 * Get a delivery with all its relations
 */
export async function getDeliveryWithRelationsFn(
  deliveryId: string
): Promise<ActionResult<DeliveryDetail>> {
  return withAction(async (ctx) => {
    const delivery = await getDeliveryWithRelationsData(ctx, deliveryId);
    return delivery;
  }, {
    fallbackMessage: "Failed to load delivery details",
    log: { message: "delivery action failed", context: { op: "delivery:detail" } },
  });
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
  return withAction(async (ctx) => {
    const validatedFilters = deliveryStatsFilterSchema.parse(filters);
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const stats = await getDeliveryStatsData(ctx, validatedFilters);
    return stats;
  }, {
    fallbackMessage: "Failed to load delivery stats",
    log: { message: "delivery action failed", context: { op: "delivery:stats" } },
  });
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new delivery
 */
export async function createDeliveryFn(
  data: z.infer<typeof createDeliverySchema>
): Promise<ActionResult<CreatedDelivery>> {
  return withAction(async (ctx) => {
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
          storageLocationId: validated.storageLocationId,
          idempotencyKey: validated.idempotencyKey,
          basisFingerprint: validated.basisFingerprint,
          driverId: validated.driverId ?? null,
          vehicleId: validated.vehicleId ?? null,
          status: validated.status,
          deliveredWetMassKg: validated.deliveredWetMassKg ?? null,
          moistureContentPercent: validated.moistureContentPercent,
          sources: validated.sources,
          distanceKmOverride: validated.distanceKmOverride ?? null,
          distanceSource: resolveDeliveryDistanceSource(
            validated.distanceKmOverride ?? null,
            validated.distanceSource,
          ),
          distanceNote: validated.distanceNote || null,
        });
      },
      CODE_CONFLICT_MESSAGES.delivery,
    );

    return delivery;
  }, {
    fallbackMessage: "Failed to create delivery",
    log: { message: "delivery action failed", context: { op: "delivery:create" } },
  });
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing delivery
 */
export async function updateDeliveryFn(
  data: z.infer<typeof updateDeliverySchema>
): Promise<ActionResult<UpdatedDelivery>> {
  return withAction(async (ctx) => {

    const validated = updateDeliverySchema.parse(data);

    const delivery = await updateDelivery(ctx, validated.deliveryId, {
      expectedVersion: validated.expectedVersion,
      sources: validated.sources,
      correctsMovementId: validated.correctsMovementId,
      idempotencyKey: validated.idempotencyKey,
      basisFingerprint: validated.basisFingerprint,
      code: validated.code,
      orderId: validated.orderId,
      facilityId: validated.facilityId,
      deliveryDate: validated.deliveryDate,
      storageLocationId: validated.storageLocationId,
      driverId: validated.driverId,
      vehicleId: validated.vehicleId,
      status: validated.status,
      deliveredWetMassKg: validated.deliveredWetMassKg,
      moistureContentPercent: validated.moistureContentPercent,
      distanceKmOverride: validated.distanceKmOverride,
      distanceSource: resolveDeliveryDistanceSource(
        validated.distanceKmOverride,
        validated.distanceSource,
      ),
      distanceNote: validated.distanceNote || null,
    });

    return delivery;
  }, { fallbackMessage: "Failed to update delivery", log: { message: "delivery action failed", context: { op: "delivery:update" } } });
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
  return withAction(async (ctx) => {

    const validated = deleteDeliverySchema.parse(data);
    await deleteDelivery(ctx, validated.deliveryId, validated.expectedVersion);

    return;
  }, { fallbackMessage: "Failed to delete delivery", log: { message: "delivery action failed", context: { op: "delivery:delete" } } });
}
