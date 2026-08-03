import { and, eq, isNull, ne } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import { deliveries, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { deliveryOrderBalanceMessage } from "@/lib/delivery-order-balance";
import { SafeError } from "@/lib/errors";
import { formatStockMinimumKg, isStockOverdraw } from "@/lib/stock-overdraw";
import { requireOrgScope } from "./utils";

type QueryExecutor = typeof db | DbTransaction;

async function deriveAllocatedWetKg(
  ctx: OrgContext,
  dbOrTx: QueryExecutor,
  orderId: string,
  excludeDeliveryId?: string,
): Promise<number> {
  const conditions = [
    eq(deliveries.orderId, orderId),
    eq(deliveries.organizationId, ctx.organizationId),
    isNull(deliveries.archivedAt),
  ];
  if (excludeDeliveryId) {
    conditions.push(ne(deliveries.id, excludeDeliveryId));
  }

  const [row] = await dbOrTx
    .select({ allocatedWetKg: sumNumeric(deliveries.deliveredWetMassKg) })
    .from(deliveries)
    .where(and(...conditions));

  return Number(row?.allocatedWetKg ?? 0);
}

export async function assertOrderQuantityCoversAllocations(
  ctx: OrgContext,
  tx: DbTransaction,
  params: { orderId: string; orderQuantityKg: number },
): Promise<void> {
  requireOrgScope(ctx);
  const allocatedWetKg = await deriveAllocatedWetKg(
    ctx,
    tx,
    params.orderId,
  );
  if (isStockOverdraw(allocatedWetKg, params.orderQuantityKg)) {
    throw new SafeError(
      `Order quantity cannot be less than the ${formatStockMinimumKg(allocatedWetKg)} already allocated to deliveries.`,
    );
  }
}

export async function deriveDeliveryOrderAvailableKg(
  ctx: OrgContext,
  dbOrTx: QueryExecutor,
  params: {
    orderId: string;
    orderQuantityKg: number;
    excludeDeliveryId?: string;
  },
): Promise<number> {
  requireOrgScope(ctx);
  const allocatedWetKg = await deriveAllocatedWetKg(
    ctx,
    dbOrTx,
    params.orderId,
    params.excludeDeliveryId,
  );
  return Math.max(0, Number(params.orderQuantityKg) - allocatedWetKg);
}

export async function assertDeliveryWithinOrderBalance(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    orderId: string;
    orderQuantityKg: number;
    requestedWetKg: number | null | undefined;
    excludeDeliveryId?: string;
  },
): Promise<void> {
  requireOrgScope(ctx);
  if (params.requestedWetKg == null) return;

  const allocatedWetKg = await deriveAllocatedWetKg(
    ctx,
    tx,
    params.orderId,
    params.excludeDeliveryId,
  );
  const availableKg = Math.max(
    0,
    Number(params.orderQuantityKg) - allocatedWetKg,
  );
  if (isStockOverdraw(params.requestedWetKg, availableKg)) {
    throw new SafeError(deliveryOrderBalanceMessage(availableKg));
  }
}

/** Lock the order before deriving its allocated delivery mass. */
export async function lockDeliveryOrderAndAssertBalance(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    orderId: string;
    requestedWetKg: number | null | undefined;
  },
): Promise<void> {
  requireOrgScope(ctx);
  const [order] = await tx
    .select({ quantityKg: orders.quantityKg })
    .from(orders)
    .where(and(
      eq(orders.id, params.orderId),
      eq(orders.organizationId, ctx.organizationId),
    ))
    .for("update");
  if (!order) throw new SafeError("Order not found");

  await assertDeliveryWithinOrderBalance(ctx, tx, {
    ...params,
    orderQuantityKg: order.quantityKg,
  });
}
