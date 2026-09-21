import { getOutputBinDryBalance, getOutputStockAllocationProjection } from './output-stock';
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

import type { db, DbTransaction } from "@/db";
import {
  biocharProducts
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  formatStockKg,
  isStockOverdraw
} from "@/lib/stock-overdraw";
import type { BinMovementLane } from "@/schemas/bin-movements";
import { and, eq } from "drizzle-orm";
import { deriveFeedstockWetStockKg } from "./feedstock-wet-stock";
import { lockBinStock } from "./lock-bin-stocks";
import { overdrawError } from "./stock-overdraw-error";
import { requireOrgScope } from "./utils";

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
  requireOrgScope(ctx);
  if (excludeDeliveryId) throw new SafeError('Stock edits require an explicit correction preview.');
  return getOutputBinDryBalance(ctx, storageLocationId, tx);
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
  requireOrgScope(ctx);
  if (excludeProductId) throw new SafeError('Product source allocations are immutable.');
  return getOutputBinDryBalance(ctx, biocharStorageLocationId, tx);
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

/** Wet mass already shipped from one product batch. */
export async function deriveBiocharProductDeliveredKg(
  ctx: OrgContext,
  tx: DbReader,
  biocharProductId: string,
  excludeDeliveryId?: string,
): Promise<number> {
  requireOrgScope(ctx);
  const [product] = await tx.select({ storageLocationId: biocharProducts.storageLocationId }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, biocharProductId)));
  if (!product?.storageLocationId) return 0;
  const rows = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: product.storageLocationId }, tx);
  return [...new Map(rows.filter(r => r.allocation.biocharProductId === biocharProductId && r.allocation.deliveryId && r.allocation.deliveryId !== excludeDeliveryId).map(r => [r.allocation.id, r.allocation])).values()].reduce((sum, a) => sum + Number(a.wetMassKg), 0);
}

/** Wet mass reserved by every non-archived delivery for one product batch. */
export async function deriveBiocharProductAllocatedKg(
  ctx: OrgContext,
  tx: DbReader,
  biocharProductId: string,
  excludeDeliveryId?: string,
): Promise<number> {
  requireOrgScope(ctx);
  return deriveBiocharProductDeliveredKg(ctx, tx, biocharProductId, excludeDeliveryId);
}
