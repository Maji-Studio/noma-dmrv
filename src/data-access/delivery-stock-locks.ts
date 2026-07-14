import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { biocharProducts, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { assertBiocharProductDrawWithinStock } from "./bin-stock-guards";
import { lockBinStocks } from "./lock-bin-stocks";

interface DeliveryStockState {
  orderId: string;
  biocharProductId: string | null;
  status: string | null;
  deliveredWetMassKg: number | null;
}

interface DeliveryStockUpdate {
  orderId?: string;
  biocharProductId?: string | null;
  status?: "upcoming" | "delivered";
  deliveredWetMassKg?: number | null;
}

/** Only delivered positive wet mass physically draws from product stock. */
export function deliveryDrawsStock(
  status: string | null | undefined,
  deliveredWetMassKg: number | null | undefined,
): deliveredWetMassKg is number {
  return (
    status === "delivered" &&
    deliveredWetMassKg != null &&
    deliveredWetMassKg > 0
  );
}

export async function lockCreateDeliveryStock(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    biocharProductId: string;
    requestedWetKg: number;
  },
): Promise<void> {
  const [lockedProduct] = await tx
    .select({
      id: biocharProducts.id,
      storageLocationId: biocharProducts.storageLocationId,
    })
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.id, params.biocharProductId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ))
    .for("update");

  if (!lockedProduct) {
    throw new SafeError("Biochar product not found");
  }

  await lockBinStocks(ctx, tx, [
    lockedProduct.storageLocationId ?? lockedProduct.id,
  ]);
  await assertBiocharProductDrawWithinStock(ctx, tx, {
    biocharProductId: params.biocharProductId,
    requestedWetKg: params.requestedWetKg,
  });
}

/**
 * Lock and validate every stock lane affected by a delivery update.
 * The delivery row is already locked by the caller. Referenced order and product
 * rows are locked in ID order before the single sorted advisory-bin batch.
 */
export async function lockDeliveryUpdateStock(
  ctx: OrgContext,
  tx: DbTransaction,
  deliveryId: string,
  locked: DeliveryStockState,
  data: DeliveryStockUpdate,
): Promise<void> {
  const transactionOrderId = data.orderId ?? locked.orderId;
  const transactionOrderIds = [...new Set([
    locked.orderId,
    transactionOrderId,
  ])];
  const transactionOrders = await tx
    .select({
      id: orders.id,
      biocharProductId: orders.biocharProductId,
    })
    .from(orders)
    .where(and(
      inArray(orders.id, transactionOrderIds),
      eq(orders.organizationId, ctx.organizationId),
    ))
    .orderBy(orders.id)
    .for("update");
  const lockedOrder = transactionOrders.find(
    (order) => order.id === locked.orderId,
  );
  const transactionOrder = transactionOrders.find(
    (order) => order.id === transactionOrderId,
  );

  if (!transactionOrder) {
    throw new SafeError("Order not found");
  }

  const lockedProductId =
    locked.biocharProductId ?? lockedOrder?.biocharProductId ?? null;
  const transactionProductId = data.biocharProductId !== undefined
    ? data.biocharProductId ?? transactionOrder.biocharProductId
    : locked.biocharProductId ?? transactionOrder.biocharProductId;
  const transactionStatus = data.status ?? locked.status;
  const transactionWetMass = data.deliveredWetMassKg !== undefined
    ? data.deliveredWetMassKg
    : locked.deliveredWetMassKg;
  const stockDerivationChanged =
    transactionStatus !== locked.status ||
    transactionWetMass !== locked.deliveredWetMassKg ||
    transactionProductId !== lockedProductId;

  if (!stockDerivationChanged) return;

  const productIds = [...new Set(
    [lockedProductId, transactionProductId].filter(
      (id): id is string => id != null,
    ),
  )];
  const productBins = productIds.length > 0
    ? await tx
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
        .for("update")
    : [];
  await lockBinStocks(
    ctx,
    tx,
    productBins.map((product) => product.storageLocationId ?? product.id),
  );

  if (
    transactionProductId &&
    deliveryDrawsStock(transactionStatus, transactionWetMass)
  ) {
    await assertBiocharProductDrawWithinStock(ctx, tx, {
      biocharProductId: transactionProductId,
      requestedWetKg: transactionWetMass,
      excludeDeliveryId: deliveryId,
    });
  }
}

export async function lockDeleteDeliveryStock(
  ctx: OrgContext,
  tx: DbTransaction,
  locked: DeliveryStockState,
): Promise<void> {
  const [lockedOrder] = await tx
    .select({ biocharProductId: orders.biocharProductId })
    .from(orders)
    .where(and(
      eq(orders.id, locked.orderId),
      eq(orders.organizationId, ctx.organizationId),
    ));
  const lockedProductId =
    locked.biocharProductId ?? lockedOrder?.biocharProductId ?? null;

  if (
    !lockedProductId ||
    !deliveryDrawsStock(locked.status, locked.deliveredWetMassKg)
  ) {
    return;
  }

  const [product] = await tx
    .select({
      id: biocharProducts.id,
      storageLocationId: biocharProducts.storageLocationId,
    })
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.id, lockedProductId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ))
    .for("update");
  await lockBinStocks(ctx, tx, [
    product?.storageLocationId ?? product?.id,
  ]);
}
