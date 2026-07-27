import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { biocharProducts, orders, productionRuns } from "@/db/schema";
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
  productCode: string | null;
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
    productCode: null,
  };
}

async function getBiocharProductAvailability(
  ctx: OrgContext,
  request: Extract<StockAvailabilityRequest, { kind: "biocharProduct" }>,
): Promise<StockAvailability> {
  const [run] = await db
    .select({
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.id, request.productionRunId),
        eq(productionRuns.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  return {
    availableKg: run?.biocharStorageLocationId
      ? await deriveBiocharAvailableKg(
          ctx,
          db,
          run.biocharStorageLocationId,
          request.biocharProductId,
        )
      : null,
    productCode: null,
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
    return { availableKg: null, productCode: null };
  }

  const [product] = await db
    .select({
      code: biocharProducts.code,
      massKg: biocharProducts.massKg,
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
    return { availableKg: null, productCode: null };
  }

  const deliveredKg = await deriveBiocharProductDeliveredKg(
    ctx,
    db,
    productId,
    request.deliveryId,
  );
  const batchAvailableKg = Number(product.massKg ?? 0) - deliveredKg;
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
    productCode: product.code,
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
