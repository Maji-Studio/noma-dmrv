/**
 * Bin over-draw guards (issue #116)
 *
 * A bin's on-hand stock is DERIVED from lineage entities (intake − consumption,
 * plus signed reconciliation movements from #194). These asserts re-derive the
 * available stock for a single lane inside the caller's transaction and hard-block
 * any withdrawal that would take the bin below zero — no tolerance (operator
 * re-confirmed 2026-07-02). Warning thresholds belong to #193, never here.
 *
 * Feedstock and biochar derivation is shared with storage summaries through
 * `deriveLaneStock`, so guards and display reads use the same balance.
 */

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { db, DbTransaction } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  binMovements,
  deliveries,
  orders,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type { OrgContext } from "@/lib/auth/server";
import type { BinMovementLane } from "@/schemas/bin-movements";
import { deriveLaneStock } from "./lane-stock-derivation";
import { requireOrgScope } from "./utils";
import { lockBinStock } from "./lock-bin-stocks";
import {
  formatStockKg,
  isStockOverdraw,
  productStockOverdrawMessage,
} from "@/lib/stock-overdraw";
import { overdrawError } from "./stock-overdraw-error";
import { deriveFeedstockWetStockKg } from "./feedstock-wet-stock";

/** Any Drizzle client that can run reads — the live `db` or a transaction. */
type DbReader = Pick<typeof db, "select">;

export { StockOverdrawError } from "./stock-overdraw-error";

/**
 * Serialize every stock read-modify-write for one physical bin. All withdrawal
 * guards and reconciliation movements use this same key, so a stock-take can
 * never race a run, product allocation, delivery, loss, or another stock-take.
 */
export { lockBinStock } from "./lock-bin-stocks";

/**
 * Round a kilogram figure for operator-facing copy (whole kg, grouped).
 * Sub-kilogram magnitudes keep one decimal — whole-kg rounding would collapse
 * them to "0 kg" and drop the sign of a small negative deficit (#116).
 */
export function formatKg(kg: number): string {
  return formatStockKg(kg);
}

/**
 * Build the shared over-draw error for a bin lane.
 * The internal product lane is user-facing biochar.
 */
export { overdrawError } from "./stock-overdraw-error";

/** True when `requestedKg` exceeds `availableKg` beyond the FP slack. */
export function isOverdraw(requestedKg: number, availableKg: number): boolean {
  return isStockOverdraw(requestedKg, availableKg);
}

/** True when a derived balance is materially above or below zero. */
export function hasNonZeroStock(availableKg: number): boolean {
  return isStockOverdraw(Math.abs(availableKg), 0);
}

export async function deriveProductAvailableKg(
  ctx: OrgContext,
  tx: DbReader,
  storageLocationId: string,
  excludeDeliveryId?: string,
): Promise<number> {
  const deliveredConditions = [
    eq(deliveries.status, "delivered"),
    eq(deliveries.organizationId, ctx.organizationId),
    eq(biocharProducts.storageLocationId, storageLocationId),
  ];
  if (excludeDeliveryId) {
    deliveredConditions.push(ne(deliveries.id, excludeDeliveryId));
  }

  const [[product], [delivered], [movement]] = await Promise.all([
    tx
      .select({
        total: sumNumeric(
          sql`COALESCE(${biocharProducts.massKg}, 0) + COALESCE(${biocharProducts.waterAddedKg}, 0)`,
        ),
      })
      .from(biocharProducts)
      .where(
        and(
          eq(biocharProducts.storageLocationId, storageLocationId),
          eq(biocharProducts.organizationId, ctx.organizationId),
        ),
      ),
    tx
      .select({
        total: sumNumeric(deliveries.deliveredWetMassKg),
      })
      .from(deliveries)
      .innerJoin(
        orders,
        and(
          eq(deliveries.orderId, orders.id),
          eq(orders.organizationId, ctx.organizationId),
        ),
      )
      .innerJoin(
        biocharProducts,
        and(
          sql`${biocharProducts.id} = COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
          eq(biocharProducts.organizationId, ctx.organizationId),
        ),
      )
      .where(and(...deliveredConditions)),
    tx
      .select({
        total: sumNumeric(binMovements.massDeltaKg),
      })
      .from(binMovements)
      .where(
        and(
          eq(binMovements.storageLocationId, storageLocationId),
          eq(binMovements.lane, "product"),
          eq(binMovements.organizationId, ctx.organizationId),
        ),
      ),
  ]);

  return product.total - delivered.total + movement.total;
}

/** Derive one bin lane while the caller holds that bin's transaction lock. */
export async function deriveBinLaneAvailableKg(
  ctx: OrgContext,
  tx: DbReader,
  storageLocationId: string,
  lane: BinMovementLane,
): Promise<number> {
  requireOrgScope(ctx);
  if (lane === "feedstock") {
    return deriveFeedstockWetStockKg(ctx, tx, storageLocationId);
  }
  if (lane === "biochar") {
    return deriveBiocharAvailableKg(ctx, tx, storageLocationId);
  }
  return deriveProductAvailableKg(ctx, tx, storageLocationId);
}

/**
 * Derived on-hand biochar (kg) for a biochar bin (the run's output bin):
 * run output − biochar-equivalent allocated to products + reconciliation deltas.
 * `excludeProductId` drops one product's allocation (its mass is being replaced).
 */
export async function deriveBiocharAvailableKg(
  ctx: OrgContext,
  tx: DbReader,
  biocharStorageLocationId: string,
  excludeProductId?: string,
): Promise<number> {
  const [stock] = await deriveLaneStock(ctx, tx, {
    storageLocationIds: [biocharStorageLocationId],
    excludeProductId,
  });
  return stock?.biocharStockKg ?? 0;
}

/**
 * Hard-block a biochar-product draw whose biochar-equivalent mass exceeds the
 * source biochar bin's derived on-hand stock. Call inside the product's
 * transaction, before inserting/updating.
 */
export async function assertBiocharDrawWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    biocharStorageLocationId: string;
    requestedBiocharKg: number;
    excludeProductId?: string;
    binLockAlreadyHeld?: boolean;
  },
): Promise<void> {
  requireOrgScope(ctx);
  if (!params.binLockAlreadyHeld) {
    await lockBinStock(ctx, tx, params.biocharStorageLocationId);
  }
  const available = await deriveBiocharAvailableKg(
    ctx,
    tx,
    params.biocharStorageLocationId,
    params.excludeProductId,
  );
  if (isOverdraw(params.requestedBiocharKg, available)) {
    throw overdrawError("biochar");
  }
}

/**
 * Hard-block a delivery that would ship more wet mass than the biochar product
 * batch physically holds: product mass − wet mass already delivered out of it.
 * Only `delivered` deliveries have left the bin (an `upcoming` one has not).
 * `excludeDeliveryId` drops the delivery being edited from the delivered sum.
 * Call inside the delivery's transaction, before writing.
 */
export async function assertBiocharProductDrawWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    biocharProductId: string;
    requestedWetKg: number;
    excludeDeliveryId?: string;
    skipBinLane?: boolean;
    binLockAlreadyHeld?: boolean;
  },
): Promise<void> {
  requireOrgScope(ctx);
  const [product] = await tx
    .select({
      massKg: biocharProducts.massKg,
      waterAddedKg: biocharProducts.waterAddedKg,
      storageLocationId: biocharProducts.storageLocationId,
    })
    .from(biocharProducts)
    .where(
      and(
        eq(biocharProducts.id, params.biocharProductId),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    );

  // Products normally belong to a bin, which shares the lock with stock-takes.
  // Fall back to the product id so two deliveries still serialize if an older
  // or partially configured product has no storage location.
  if (!params.binLockAlreadyHeld) {
    await lockBinStock(
      ctx,
      tx,
      product?.storageLocationId ?? params.biocharProductId,
    );
  }

  const deliveredKg = await deriveBiocharProductDeliveredKg(
    ctx,
    tx,
    params.biocharProductId,
    params.excludeDeliveryId,
  );
  const batchAvailable =
    Number(product?.massKg ?? 0) +
    Number(product?.waterAddedKg ?? 0) -
    deliveredKg;
  if (isOverdraw(params.requestedWetKg, batchAvailable)) {
    throw new SafeError(productStockOverdrawMessage());
  }

  if (product?.storageLocationId && !params.skipBinLane) {
    const binAvailable = await deriveProductAvailableKg(
      ctx,
      tx,
      product.storageLocationId,
      params.excludeDeliveryId,
    );
    if (isOverdraw(params.requestedWetKg, binAvailable)) {
      throw overdrawError("product");
    }
  }
}

/** Wet mass already shipped from one product batch. */
export async function deriveBiocharProductDeliveredKg(
  ctx: OrgContext,
  tx: DbReader,
  biocharProductId: string,
  excludeDeliveryId?: string,
): Promise<number> {
  requireOrgScope(ctx);
  const deliveredConditions = [
    eq(deliveries.status, "delivered"),
    eq(deliveries.organizationId, ctx.organizationId),
    sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId}) = ${biocharProductId}`,
  ];
  if (excludeDeliveryId) {
    deliveredConditions.push(ne(deliveries.id, excludeDeliveryId));
  }

  const [delivered] = await tx
    .select({
      total: sumNumeric(deliveries.deliveredWetMassKg),
    })
    .from(deliveries)
    .innerJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .where(and(...deliveredConditions));

  return delivered.total;
}

/** Wet mass reserved by every non-archived delivery for one product batch. */
export async function deriveBiocharProductAllocatedKg(
  ctx: OrgContext,
  tx: DbReader,
  biocharProductId: string,
  excludeDeliveryId?: string,
): Promise<number> {
  requireOrgScope(ctx);
  const allocationConditions = [
    eq(deliveries.organizationId, ctx.organizationId),
    isNull(deliveries.archivedAt),
    sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId}) = ${biocharProductId}`,
  ];
  if (excludeDeliveryId) {
    allocationConditions.push(ne(deliveries.id, excludeDeliveryId));
  }

  const [allocated] = await tx
    .select({ total: sumNumeric(deliveries.deliveredWetMassKg) })
    .from(deliveries)
    .innerJoin(
      orders,
      and(
        eq(deliveries.orderId, orders.id),
        eq(orders.organizationId, ctx.organizationId),
      ),
    )
    .where(and(...allocationConditions));

  return allocated.total;
}
