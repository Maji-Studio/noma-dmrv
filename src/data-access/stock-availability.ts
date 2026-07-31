import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { StockAvailabilityRequest } from "@/schemas/stock-availability";
import {
  deriveBiocharAvailableKg,
  deriveBiocharProductDeliveredKg,
  deriveFeedstockAvailableKg,
  deriveProductAvailableKg,
} from "./bin-stock-guards";
import { requireOrgScope } from "./utils";

export interface StockAvailability {
  availableKg: number | null;
}

async function getProductionRunFeedstockAvailability(
  ctx: OrgContext,
  request: Extract<
    StockAvailabilityRequest,
    { kind: "productionRunFeedstock" }
  >,
): Promise<StockAvailability> {
  return {
    availableKg: await deriveFeedstockAvailableKg(
      ctx,
      db,
      request.storageLocationId,
      request.productionRunId,
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
  const [order] = await db
    .select({ biocharProductId: orders.biocharProductId })
    .from(orders)
    .where(
      and(
        eq(orders.id, request.orderId),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  const productId = request.biocharProductId ?? order?.biocharProductId;
  if (!productId) {
    return { availableKg: null };
  }

  const [product] = await db
    .select({
      massKg: biocharProducts.massKg,
      waterAddedKg: biocharProducts.waterAddedKg,
      storageLocationId: biocharProducts.storageLocationId,
    })
    .from(biocharProducts)
    .where(
      and(
        eq(biocharProducts.id, productId),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!product) {
    return { availableKg: null };
  }

  const deliveredKg = await deriveBiocharProductDeliveredKg(
    ctx,
    db,
    productId,
    request.deliveryId,
  );
  const batchAvailableKg =
    Number(product.massKg ?? 0) +
    Number(product.waterAddedKg ?? 0) -
    deliveredKg;
  const binAvailableKg = product.storageLocationId
    ? await deriveProductAvailableKg(
        ctx,
        db,
        product.storageLocationId,
        request.deliveryId,
      )
    : batchAvailableKg;

  return {
    availableKg: Math.min(batchAvailableKg, binAvailableKg),
  };
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
