import { db } from "@/db";
import { orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { StockAvailabilityRequest } from "@/schemas/stock-availability";
import { and, eq } from "drizzle-orm";
import {
  deriveBiocharAvailableKg
} from "./bin-stock-guards";
import { deriveDeliveryOrderAvailableKg } from "./delivery-order-balance";
import { deriveFeedstockWetStockKg } from "./feedstock-wet-stock";
import { requireOrgScope } from "./utils";

export interface StockAvailability {
  availableKg: number | null;
  orderAvailableKg?: number | null;
}

async function getProductionRunFeedstockAvailability(
  ctx: OrgContext,
  request: Extract<
    StockAvailabilityRequest,
    { kind: "productionRunFeedstock" }
  >,
): Promise<StockAvailability> {
  return {
    availableKg: await deriveFeedstockWetStockKg(
      ctx,
      db,
      request.storageLocationId,
      { excludeRunId: request.productionRunId },
    ),
  };
}

async function getBiocharProductAvailability(
  ctx: OrgContext,
  request: Extract<StockAvailabilityRequest, { kind: "biocharProduct" }>,
): Promise<StockAvailability> {
  return {
    availableKg: await deriveBiocharAvailableKg(
      ctx,
      db,
      request.sourceBiocharStorageLocationId,
      request.biocharProductId,
    ),
  };
}

async function getDeliveryAvailability(
  ctx: OrgContext,
  request: Extract<StockAvailabilityRequest, { kind: "delivery" }>,
): Promise<StockAvailability> {
  requireOrgScope(ctx);
  const [order] = await db.select({ quantityKg: orders.quantityKg }).from(orders).where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, request.orderId)));
  const orderAvailableKg = order ? await deriveDeliveryOrderAvailableKg(ctx, db, { orderId: request.orderId, orderQuantityKg: order.quantityKg, excludeDeliveryId: request.deliveryId }) : null;
  // A wet capacity cannot be inferred without the selected bin and measured moisture.
  return { availableKg: null, orderAvailableKg };
}

export async function getStockAvailability(
  ctx: OrgContext,
  request: StockAvailabilityRequest,
): Promise<StockAvailability> {
  requireOrgScope(ctx);
  switch (request.kind) {
    case "productionRunFeedstock":
      return getProductionRunFeedstockAvailability(ctx, request);
    case "biocharProduct":
      return getBiocharProductAvailability(ctx, request);
    case "delivery":
      return getDeliveryAvailability(ctx, request);
  }
}
