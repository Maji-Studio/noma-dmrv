import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { biocharProducts, deliveries, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { assertBiocharProductDrawWithinStock } from "./bin-stock-guards";
import {
  assertStockLockSnapshot,
  lockBinStocks,
} from "./lock-bin-stocks";

interface DeliveryStockState {
  orderId: string;
  biocharProductId: string | null;
  status: string | null;
  deliveredWetMassKg: number | null;
  massDryKg: number | null;
  truckMassOnArrivalKg: number | null;
  truckMassOnDepartureKg: number | null;
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
  const [productSnapshot] = await tx
    .select({
      id: biocharProducts.id,
      storageLocationId: biocharProducts.storageLocationId,
    })
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.id, params.biocharProductId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ));

  if (!productSnapshot) {
    throw new SafeError("Biochar product not found");
  }

  await lockBinStocks(ctx, tx, [
    productSnapshot.storageLocationId ?? productSnapshot.id,
  ]);
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
  assertStockLockSnapshot(
    lockedProduct?.id === productSnapshot.id &&
      lockedProduct?.storageLocationId === productSnapshot.storageLocationId,
  );
  await assertBiocharProductDrawWithinStock(ctx, tx, {
    biocharProductId: params.biocharProductId,
    requestedWetKg: params.requestedWetKg,
    binLockAlreadyHeld: true,
  });
}

/** Lock the bin batch first, then rows, and validate a delivery update. */
export async function lockDeliveryUpdateStock(
  ctx: OrgContext,
  tx: DbTransaction,
  deliveryId: string,
  data: DeliveryStockUpdate,
): Promise<DeliveryStockState & { id: string }> {
  const [snapshot] = await tx
    .select({
      id: deliveries.id,
      orderId: deliveries.orderId,
      biocharProductId: deliveries.biocharProductId,
      status: deliveries.status,
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      massDryKg: deliveries.massDryKg,
      truckMassOnArrivalKg: deliveries.truckMassOnArrivalKg,
      truckMassOnDepartureKg: deliveries.truckMassOnDepartureKg,
    })
    .from(deliveries)
    .where(and(
      eq(deliveries.id, deliveryId),
      eq(deliveries.organizationId, ctx.organizationId),
    ));
  if (!snapshot) {
    throw new SafeError("Delivery not found");
  }

  const transactionOrderId = data.orderId ?? snapshot.orderId;
  const transactionOrderIds = [...new Set([
    snapshot.orderId,
    transactionOrderId,
  ])];
  const orderSnapshots = await tx
    .select({
      id: orders.id,
      biocharProductId: orders.biocharProductId,
    })
    .from(orders)
    .where(and(
      inArray(orders.id, transactionOrderIds),
      eq(orders.organizationId, ctx.organizationId),
    ));
  const snapshotOrder = orderSnapshots.find(
    (order) => order.id === snapshot.orderId,
  );
  const transactionOrderSnapshot = orderSnapshots.find(
    (order) => order.id === transactionOrderId,
  );

  if (!transactionOrderSnapshot) {
    throw new SafeError("Order not found");
  }

  const snapshotProductId =
    snapshot.biocharProductId ?? snapshotOrder?.biocharProductId ?? null;
  const transactionProductSnapshotId = data.biocharProductId !== undefined
    ? data.biocharProductId ?? transactionOrderSnapshot.biocharProductId
    : snapshot.biocharProductId ?? transactionOrderSnapshot.biocharProductId;
  const transactionStatus = data.status ?? snapshot.status;
  const transactionWetMass = data.deliveredWetMassKg !== undefined
    ? data.deliveredWetMassKg
    : snapshot.deliveredWetMassKg;
  const stockDerivationChanged =
    transactionOrderId !== snapshot.orderId ||
    transactionStatus !== snapshot.status ||
    transactionWetMass !== snapshot.deliveredWetMassKg ||
    transactionProductSnapshotId !== snapshotProductId;

  const productIds = [...new Set(
    [snapshotProductId, transactionProductSnapshotId].filter(
      (id): id is string => id != null,
    ),
  )];
  const productSnapshots = stockDerivationChanged && productIds.length > 0
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
    : [];
  await lockBinStocks(
    ctx,
    tx,
    productSnapshots.map((product) => product.storageLocationId ?? product.id),
  );

  const [locked] = await tx
    .select({
      id: deliveries.id,
      orderId: deliveries.orderId,
      biocharProductId: deliveries.biocharProductId,
      status: deliveries.status,
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      massDryKg: deliveries.massDryKg,
      truckMassOnArrivalKg: deliveries.truckMassOnArrivalKg,
      truckMassOnDepartureKg: deliveries.truckMassOnDepartureKg,
    })
    .from(deliveries)
    .where(and(
      eq(deliveries.id, deliveryId),
      eq(deliveries.organizationId, ctx.organizationId),
    ))
    .for("update");
  if (!locked) {
    throw new SafeError("Delivery not found");
  }
  assertStockLockSnapshot(
    locked.orderId === snapshot.orderId &&
      locked.biocharProductId === snapshot.biocharProductId &&
      locked.status === snapshot.status &&
      locked.deliveredWetMassKg === snapshot.deliveredWetMassKg &&
      locked.massDryKg === snapshot.massDryKg &&
      locked.truckMassOnArrivalKg === snapshot.truckMassOnArrivalKg &&
      locked.truckMassOnDepartureKg === snapshot.truckMassOnDepartureKg,
  );

  if (!stockDerivationChanged) return locked;

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
  assertStockLockSnapshot(
    transactionOrders.length === orderSnapshots.length &&
      transactionOrders.every((lockedOrder) => {
        const orderSnapshot = orderSnapshots.find(
          (order) => order.id === lockedOrder.id,
        );
        return orderSnapshot?.biocharProductId === lockedOrder.biocharProductId;
      }),
  );

  const transactionOrder = transactionOrders.find(
    (order) => order.id === transactionOrderId,
  );
  if (!transactionOrder) {
    throw new SafeError("Order not found");
  }
  const transactionProductId = data.biocharProductId !== undefined
    ? data.biocharProductId ?? transactionOrder.biocharProductId
    : locked.biocharProductId ?? transactionOrder.biocharProductId;

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
  assertStockLockSnapshot(
    productBins.length === productSnapshots.length &&
      productBins.every((lockedProduct) => {
        const productSnapshot = productSnapshots.find(
          (product) => product.id === lockedProduct.id,
        );
        return productSnapshot?.storageLocationId ===
          lockedProduct.storageLocationId;
      }),
  );

  if (
    transactionProductId &&
    deliveryDrawsStock(transactionStatus, transactionWetMass)
  ) {
    await assertBiocharProductDrawWithinStock(ctx, tx, {
      biocharProductId: transactionProductId,
      requestedWetKg: transactionWetMass,
      excludeDeliveryId: deliveryId,
      binLockAlreadyHeld: true,
    });
  }

  return locked;
}

export async function lockDeleteDeliveryStock(
  ctx: OrgContext,
  tx: DbTransaction,
  deliveryId: string,
): Promise<DeliveryStockState & { id: string }> {
  const [snapshot] = await tx
    .select({
      id: deliveries.id,
      orderId: deliveries.orderId,
      biocharProductId: deliveries.biocharProductId,
      status: deliveries.status,
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      massDryKg: deliveries.massDryKg,
      truckMassOnArrivalKg: deliveries.truckMassOnArrivalKg,
      truckMassOnDepartureKg: deliveries.truckMassOnDepartureKg,
    })
    .from(deliveries)
    .where(and(
      eq(deliveries.id, deliveryId),
      eq(deliveries.organizationId, ctx.organizationId),
    ));

  if (!snapshot) {
    throw new SafeError("Delivery not found");
  }

  const [orderSnapshot] = await tx
    .select({ biocharProductId: orders.biocharProductId })
    .from(orders)
    .where(and(
      eq(orders.id, snapshot.orderId),
      eq(orders.organizationId, ctx.organizationId),
    ));
  const snapshotProductId =
    snapshot.biocharProductId ?? orderSnapshot?.biocharProductId ?? null;
  const [productSnapshot] =
    snapshotProductId &&
    deliveryDrawsStock(snapshot.status, snapshot.deliveredWetMassKg)
      ? await tx
          .select({
            id: biocharProducts.id,
            storageLocationId: biocharProducts.storageLocationId,
          })
          .from(biocharProducts)
          .where(and(
            eq(biocharProducts.id, snapshotProductId),
            eq(biocharProducts.organizationId, ctx.organizationId),
          ))
      : [];

  await lockBinStocks(ctx, tx, [
    productSnapshot?.storageLocationId ?? productSnapshot?.id,
  ]);

  const [locked] = await tx
    .select({
      id: deliveries.id,
      orderId: deliveries.orderId,
      biocharProductId: deliveries.biocharProductId,
      status: deliveries.status,
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      massDryKg: deliveries.massDryKg,
      truckMassOnArrivalKg: deliveries.truckMassOnArrivalKg,
      truckMassOnDepartureKg: deliveries.truckMassOnDepartureKg,
    })
    .from(deliveries)
    .where(and(
      eq(deliveries.id, deliveryId),
      eq(deliveries.organizationId, ctx.organizationId),
    ))
    .for("update");

  if (!locked) {
    throw new SafeError("Delivery not found");
  }
  assertStockLockSnapshot(
    locked.orderId === snapshot.orderId &&
      locked.biocharProductId === snapshot.biocharProductId &&
      locked.status === snapshot.status &&
      locked.deliveredWetMassKg === snapshot.deliveredWetMassKg &&
      locked.massDryKg === snapshot.massDryKg &&
      locked.truckMassOnArrivalKg === snapshot.truckMassOnArrivalKg &&
      locked.truckMassOnDepartureKg === snapshot.truckMassOnDepartureKg,
  );

  const [lockedOrder] = await tx
    .select({ biocharProductId: orders.biocharProductId })
    .from(orders)
    .where(and(
      eq(orders.id, locked.orderId),
      eq(orders.organizationId, ctx.organizationId),
    ))
    .for("update");
  if (locked.biocharProductId === null) {
    assertStockLockSnapshot(
      lockedOrder?.biocharProductId === orderSnapshot?.biocharProductId,
    );
  }
  const lockedProductId =
    locked.biocharProductId ?? lockedOrder?.biocharProductId ?? null;

  if (
    !lockedProductId ||
    !deliveryDrawsStock(locked.status, locked.deliveredWetMassKg)
  ) {
    return locked;
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
  assertStockLockSnapshot(
    product?.id === productSnapshot?.id &&
      product?.storageLocationId === productSnapshot?.storageLocationId,
  );

  return locked;
}
