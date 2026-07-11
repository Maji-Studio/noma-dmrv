/**
 * Bin over-draw guards (issue #116)
 *
 * A bin's on-hand stock is DERIVED from lineage entities (intake − consumption,
 * plus signed reconciliation movements from #194). These asserts re-derive the
 * available stock for a single lane inside the caller's transaction and hard-block
 * any withdrawal that would take the bin below zero — no tolerance (operator
 * re-confirmed 2026-07-02). Warning thresholds belong to #193, never here.
 *
 * The block error states the available quantity and points the operator at the
 * bin's on-demand reconcile workflow (#194: Storage locations → bin → Reconcile
 * stock), where a stock-take adjustment or documented loss brings the derived
 * count back in line before the draw is retried.
 *
 * The derivation mirrors `storage-location-enrichment.ts` lane-by-lane; keep the
 * two in step if either changes.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
  feedstocks,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
  binMovements,
  deliveries,
  orders,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/** Any Drizzle client that can run reads — the live `db` or a transaction. */
type DbReader = Pick<typeof db, "select">;

/**
 * Floating-point slack (kg). Derived stock is a sum of floating-point masses, so
 * an exactly-equal draw can land a hair over its available stock. Only a draw
 * beyond this slack is a real over-draw.
 */
const STOCK_OVERDRAW_EPSILON_KG = 1e-6;

/**
 * Round a kilogram figure for operator-facing copy (whole kg, grouped).
 * Sub-kilogram magnitudes keep one decimal — whole-kg rounding would collapse
 * them to "0 kg" and drop the sign of a small negative deficit (#116).
 */
function formatKg(kg: number): string {
  if (kg !== 0 && Math.abs(kg) < 1) return `${kg.toFixed(1)} kg`;
  return `${Math.round(kg).toLocaleString()} kg`;
}

/**
 * Build the shared over-draw error: available quantity + reconcile pointer.
 * `material` names the lane in plain language ("feedstock", "biochar", …).
 * The available quantity is shown as derived — no zero-clamp — so an already
 * over-drawn bin surfaces its true (negative) deficit for reconciliation (#116).
 */
function overdrawError(
  material: string,
  availableKg: number,
  requestedKg: number,
): SafeError {
  const available = formatKg(availableKg);
  return new SafeError(
    `Not enough ${material} in this bin — ${available} available but this draw needs ${formatKg(
      requestedKg,
    )}. Reconcile the bin's stock (Storage locations → the bin → Reconcile stock), then try again.`,
  );
}

/** True when `requestedKg` exceeds `availableKg` beyond the FP slack. */
function isOverdraw(requestedKg: number, availableKg: number): boolean {
  return requestedKg - availableKg > STOCK_OVERDRAW_EPSILON_KG;
}

/**
 * Derived on-hand feedstock (dry kg) for a feedstock bin:
 * complete-batch intake − consumption by production runs + reconciliation deltas.
 * `excludeRunId` drops one run's consumption (its allocation is being replaced).
 */
async function deriveFeedstockAvailableKg(
  ctx: OrgContext,
  tx: DbReader,
  storageLocationId: string,
  excludeRunId?: string,
): Promise<number> {
  const consumptionConditions = [
    eq(productionRuns.feedstockStorageLocationId, storageLocationId),
    eq(productionRuns.organizationId, ctx.organizationId),
  ];
  if (excludeRunId) {
    consumptionConditions.push(ne(productionRuns.id, excludeRunId));
  }

  const [[intake], [consumed], [movement]] = await Promise.all([
    tx
      .select({
        total: sql<number>`COALESCE(SUM(${feedstocks.massDryKg}) FILTER (WHERE ${feedstocks.status} = 'complete'), 0)`,
      })
      .from(feedstocks)
      .where(and(eq(feedstocks.storageLocationId, storageLocationId), eq(feedstocks.organizationId, ctx.organizationId))),
    tx
      .select({
        total: sql<number>`COALESCE(SUM(${productionRunFeedstocks.massUsedKg}), 0)`,
      })
      .from(productionRuns)
      .leftJoin(
        productionRunFeedstocks,
        and(eq(productionRunFeedstocks.productionRunId, productionRuns.id), eq(productionRunFeedstocks.organizationId, ctx.organizationId)),
      )
      .where(and(...consumptionConditions)),
    tx
      .select({
        total: sql<number>`COALESCE(SUM(${binMovements.massDeltaKg}), 0)`,
      })
      .from(binMovements)
      .where(
        and(
          eq(binMovements.storageLocationId, storageLocationId),
          eq(binMovements.lane, "feedstock"),
          eq(binMovements.organizationId, ctx.organizationId),
        ),
      ),
  ]);

  return Number(intake.total) - Number(consumed.total) + Number(movement.total);
}

/**
 * Hard-block a production-run feedstock draw that exceeds the bin's derived
 * on-hand dry stock. Call inside the run's transaction, before allocating.
 */
export async function assertFeedstockDrawWithinStock(
  ctx: OrgContext,
  tx: DbReader,
  params: {
    storageLocationId: string;
    requestedDryKg: number;
    excludeRunId?: string;
  },
): Promise<void> {
  requireOrgScope(ctx);
  const available = await deriveFeedstockAvailableKg(
    ctx,
    tx,
    params.storageLocationId,
    params.excludeRunId,
  );
  if (isOverdraw(params.requestedDryKg, available)) {
    throw overdrawError("feedstock", available, params.requestedDryKg);
  }
}

/**
 * Derived on-hand biochar (kg) for a biochar bin (the run's output bin):
 * run output − biochar-equivalent allocated to products + reconciliation deltas.
 * `excludeProductId` drops one product's allocation (its mass is being replaced).
 */
async function deriveBiocharAvailableKg(
  ctx: OrgContext,
  tx: DbReader,
  biocharStorageLocationId: string,
  excludeProductId?: string,
): Promise<number> {
  const allocationConditions = [
    eq(productionRuns.biocharStorageLocationId, biocharStorageLocationId),
    eq(productionRuns.organizationId, ctx.organizationId),
  ];
  if (excludeProductId) {
    allocationConditions.push(ne(biocharProducts.id, excludeProductId));
  }

  const [[produced], [allocated], [movement]] = await Promise.all([
    tx
      .select({
        total: sql<number>`COALESCE(SUM(${productionRuns.biocharOutputKg}), 0)`,
      })
      .from(productionRuns)
      .where(and(
        eq(productionRuns.biocharStorageLocationId, biocharStorageLocationId),
        eq(productionRuns.organizationId, ctx.organizationId),
      )),
    tx
      .select({
        total: sql<number>`COALESCE(SUM(COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)), 0)`,
      })
      .from(productionRuns)
      .innerJoin(
        biocharProducts,
        and(eq(biocharProducts.linkedProductionRunId, productionRuns.id), eq(biocharProducts.organizationId, ctx.organizationId)),
      )
      .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
      .where(and(...allocationConditions)),
    tx
      .select({
        total: sql<number>`COALESCE(SUM(${binMovements.massDeltaKg}), 0)`,
      })
      .from(binMovements)
      .where(
        and(
          eq(binMovements.storageLocationId, biocharStorageLocationId),
          eq(binMovements.lane, "biochar"),
          eq(binMovements.organizationId, ctx.organizationId),
        ),
      ),
  ]);

  return (
    Number(produced.total) - Number(allocated.total) + Number(movement.total)
  );
}

/**
 * Hard-block a biochar-product draw whose biochar-equivalent mass exceeds the
 * source biochar bin's derived on-hand stock. Call inside the product's
 * transaction, before inserting/updating.
 */
export async function assertBiocharDrawWithinStock(
  ctx: OrgContext,
  tx: DbReader,
  params: {
    biocharStorageLocationId: string;
    requestedBiocharKg: number;
    excludeProductId?: string;
  },
): Promise<void> {
  requireOrgScope(ctx);
  const available = await deriveBiocharAvailableKg(
    ctx,
    tx,
    params.biocharStorageLocationId,
    params.excludeProductId,
  );
  if (isOverdraw(params.requestedBiocharKg, available)) {
    throw overdrawError("biochar", available, params.requestedBiocharKg);
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
  tx: DbReader,
  params: {
    biocharProductId: string;
    requestedWetKg: number;
    excludeDeliveryId?: string;
  },
): Promise<void> {
  requireOrgScope(ctx);
  const deliveredConditions = [
    eq(deliveries.status, "delivered"),
    eq(deliveries.organizationId, ctx.organizationId),
    sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId}) = ${params.biocharProductId}`,
  ];
  if (params.excludeDeliveryId) {
    deliveredConditions.push(ne(deliveries.id, params.excludeDeliveryId));
  }

  const [[product], [delivered]] = await Promise.all([
    tx
      .select({ code: biocharProducts.code, massKg: biocharProducts.massKg })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.id, params.biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId))),
    tx
      .select({
        total: sql<number>`COALESCE(SUM(${deliveries.deliveredWetMassKg}), 0)`,
      })
      .from(deliveries)
      .innerJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
      .where(and(...deliveredConditions)),
  ]);

  const available = Number(product?.massKg ?? 0) - Number(delivered.total);
  if (isOverdraw(params.requestedWetKg, available)) {
    // Batch-specific copy: a delivery over-draw is against the product batch's
    // remaining wet mass, not a bin lane, so the #194 bin reconcile workflow is
    // the wrong lever — point the operator at the source bin or the product.
    throw new SafeError(
      `Cannot deliver ${formatKg(params.requestedWetKg)} from product ${
        product?.code ?? "this batch"
      }: only ${formatKg(
        available,
      )} remain undelivered. Reconcile the source bin or adjust the product before delivering.`,
    );
  }
}
