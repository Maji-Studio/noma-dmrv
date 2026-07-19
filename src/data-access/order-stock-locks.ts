import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import { biocharProducts, deliveries, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { assertBiocharProductDrawWithinStock } from "./bin-stock-guards";
import {
  assertStockLockSnapshot,
  lockBinStocks,
} from "./lock-bin-stocks";

interface ProductBinSnapshot {
  id: string;
  storageLocationId: string | null;
}

export interface OrderProductRepointPreparation {
  previousProductId: string;
  productBins: ProductBinSnapshot[];
}

/** Discover and lock both product lanes before any row is locked. */
export async function lockOrderProductRepointBins(
  ctx: OrgContext,
  tx: DbTransaction,
  orderId: string,
  targetProductId: string,
): Promise<OrderProductRepointPreparation> {
  const [order] = await tx
    .select({ biocharProductId: orders.biocharProductId })
    .from(orders)
    .where(and(
      eq(orders.id, orderId),
      eq(orders.organizationId, ctx.organizationId),
    ));

  if (!order) {
    throw new SafeError("Order not found");
  }

  const productIds = [...new Set([
    order.biocharProductId,
    targetProductId,
  ])];
  const productBins = await tx
    .select({
      id: biocharProducts.id,
      storageLocationId: biocharProducts.storageLocationId,
    })
    .from(biocharProducts)
    .where(and(
      inArray(biocharProducts.id, productIds),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ));

  await lockBinStocks(
    ctx,
    tx,
    productBins.map((product) => product.storageLocationId ?? product.id),
  );

  return {
    previousProductId: order.biocharProductId,
    productBins,
  };
}

/** Lock the discovered product rows and validate the inherited delivery draw. */
export async function assertOrderProductRepointWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  orderId: string,
  lockedPreviousProductId: string,
  targetProductId: string,
  preparation: OrderProductRepointPreparation,
): Promise<void> {
  if (targetProductId === lockedPreviousProductId) return;

  assertStockLockSnapshot(
    preparation.previousProductId === lockedPreviousProductId,
  );

  const productIds = [...new Set([
    lockedPreviousProductId,
    targetProductId,
  ])];
  const lockedProductBins = await tx
    .select({
      id: biocharProducts.id,
      storageLocationId: biocharProducts.storageLocationId,
    })
    .from(biocharProducts)
    .where(and(
      inArray(biocharProducts.id, productIds),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ))
    .orderBy(biocharProducts.id)
    .for("update");

  assertStockLockSnapshot(
    lockedProductBins.length === preparation.productBins.length &&
      lockedProductBins.every((lockedProduct) => {
        const snapshot = preparation.productBins.find(
          (product) => product.id === lockedProduct.id,
        );
        return snapshot?.storageLocationId === lockedProduct.storageLocationId;
      }),
  );

  const [inheritedDraw] = await tx
    .select({
      total: sumNumeric(deliveries.deliveredWetMassKg),
    })
    .from(deliveries)
    .where(and(
      eq(deliveries.orderId, orderId),
      eq(deliveries.organizationId, ctx.organizationId),
      eq(deliveries.status, "delivered"),
      isNull(deliveries.biocharProductId),
      gt(deliveries.deliveredWetMassKg, 0),
    ));
  const inheritedDrawKg = inheritedDraw.total;
  if (inheritedDrawKg <= 0) return;

  const previousProduct = lockedProductBins.find(
    (product) => product.id === lockedPreviousProductId,
  );
  const targetProduct = lockedProductBins.find(
    (product) => product.id === targetProductId,
  );
  const binLaneIsInvariant =
    previousProduct?.storageLocationId != null &&
    previousProduct.storageLocationId === targetProduct?.storageLocationId;

  await assertBiocharProductDrawWithinStock(ctx, tx, {
    biocharProductId: targetProductId,
    requestedWetKg: inheritedDrawKg,
    skipBinLane: binLaneIsInvariant,
    binLockAlreadyHeld: true,
  });
}
