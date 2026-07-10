/**
 * Bin over-draw guards (issue #116)
 *
 * Hard, zero-tolerance block on any withdrawal that exceeds a bin's derived
 * on-hand stock. Runs inside the caller's transaction so the check and the write
 * commit together. The available-stock derivations MUST mirror
 * `storage-location-enrichment.ts` (intake − consumption + signed movements) so
 * the number quoted in a block error matches what the operator sees on the bin.
 *
 * Tolerance thresholds are a separate WARNING concern (#193) and never belong
 * here. The only slack is `STOCK_EPSILON_KG`, which absorbs floating-point noise
 * (e.g. proportional dry-mass splits) so drawing exactly the on-hand amount is
 * never rejected by a sub-gram rounding artifact — it is not a domain tolerance.
 *
 * When a draw is blocked, the operator reconciles the bin via the on-demand
 * reconciliation workflow (#194) on the Storage locations page, then retries.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  feedstocks,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
  binMovements,
  deliveries,
  orders,
  storageLocations,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";

/** Sub-gram slack that only absorbs floating-point noise — NOT a tolerance. */
const STOCK_EPSILON_KG = 1e-6;

const RECONCILE_HINT =
  "Reconcile the bin on the Storage locations page (record a stock-take adjustment or documented loss), then retry.";

function formatKg(kg: number): string {
  return `${Math.round(kg).toLocaleString()} kg`;
}

/**
 * Signed sum of reconciliation movements for one bin + lane (#194 overlay).
 */
async function movementLaneDeltaKg(
  tx: DbTransaction,
  storageLocationId: string,
  lane: "feedstock" | "biochar",
): Promise<number> {
  const [row] = await tx
    .select({
      delta: sql<number>`COALESCE(SUM(${binMovements.massDeltaKg}), 0)`,
    })
    .from(binMovements)
    .where(
      and(
        eq(binMovements.storageLocationId, storageLocationId),
        eq(binMovements.lane, lane),
      ),
    );
  return Number(row?.delta ?? 0);
}

/**
 * Reject a production-run feedstock draw larger than the bin's on-hand dry stock.
 *
 * Available = complete-batch dry intake − dry mass already consumed by runs
 * (optionally excluding one run, so an edit doesn't count its own prior draw) +
 * signed feedstock movements. Mirrors the feedstock lane of enrichment.
 */
export async function assertFeedstockDrawAvailable(
  tx: DbTransaction,
  params: {
    storageLocationId: string;
    requestedDryKg: number;
    /** Exclude this run's own consumption (its rows are being re-allocated). */
    excludeRunId?: string;
  },
): Promise<void> {
  const { storageLocationId, requestedDryKg, excludeRunId } = params;
  if (requestedDryKg <= 0) return;

  const [intakeRow] = await tx
    .select({
      code: storageLocations.code,
      totalDryKg: sql<number>`
        COALESCE(
          (
            SELECT SUM(${feedstocks.massDryKg})
            FROM ${feedstocks}
            WHERE ${feedstocks.storageLocationId} = ${storageLocations.id}
              AND ${feedstocks.status} = 'complete'
          ),
          0
        )
      `,
    })
    .from(storageLocations)
    .where(eq(storageLocations.id, storageLocationId));

  if (!intakeRow) {
    throw new SafeError("Feedstock storage location not found");
  }

  const consumedConditions = [
    eq(productionRuns.feedstockStorageLocationId, storageLocationId),
  ];
  if (excludeRunId) {
    consumedConditions.push(ne(productionRuns.id, excludeRunId));
  }

  const [consumedRow] = await tx
    .select({
      consumedDryKg: sql<number>`COALESCE(SUM(${productionRunFeedstocks.massUsedKg}), 0)`,
    })
    .from(productionRuns)
    .leftJoin(
      productionRunFeedstocks,
      eq(productionRunFeedstocks.productionRunId, productionRuns.id),
    )
    .where(and(...consumedConditions));

  const movementDelta = await movementLaneDeltaKg(
    tx,
    storageLocationId,
    "feedstock",
  );

  const availableKg =
    Number(intakeRow.totalDryKg) -
    Number(consumedRow?.consumedDryKg ?? 0) +
    movementDelta;

  if (requestedDryKg > availableKg + STOCK_EPSILON_KG) {
    throw new SafeError(
      `Cannot draw ${formatKg(requestedDryKg)} of feedstock from bin ${intakeRow.code}: only ${formatKg(
        availableKg,
      )} on hand. ${RECONCILE_HINT}`,
    );
  }
}

/**
 * Reject a biochar draw (a new/edited product) larger than the source bin's
 * on-hand biochar. The source bin is the linked run's biochar bin; when the run
 * has no biochar bin there is nothing to guard.
 *
 * Available = biochar produced into the bin − biochar already allocated to
 * products (mass × biochar ratio, optionally excluding one product) + signed
 * biochar movements. Mirrors the biochar lane of enrichment.
 */
export async function assertBiocharDrawAvailable(
  tx: DbTransaction,
  params: {
    linkedProductionRunId: string;
    /** Product wet mass; the biochar drawn is this × the formulation's ratio. */
    massKg: number;
    formulationId: string | null;
    /** Exclude this product's own allocation (it is being re-measured). */
    excludeProductId?: string;
  },
): Promise<void> {
  const { linkedProductionRunId, massKg, formulationId, excludeProductId } =
    params;
  if (massKg <= 0) return;

  // Biochar equivalent drawn = wet mass × biochar ratio (1 for pure biochar),
  // matching the allocation term in enrichment.
  let biocharRatio = 1;
  if (formulationId) {
    const [formulation] = await tx
      .select({ ratio: formulations.biocharRatio })
      .from(formulations)
      .where(eq(formulations.id, formulationId));
    biocharRatio = Number(formulation?.ratio ?? 1);
  }
  const requestedBiocharKg = massKg * biocharRatio;
  if (requestedBiocharKg <= 0) return;

  const [runRow] = await tx
    .select({ binId: productionRuns.biocharStorageLocationId })
    .from(productionRuns)
    .where(eq(productionRuns.id, linkedProductionRunId));

  const binId = runRow?.binId;
  if (!binId) return; // Run's biochar isn't tracked in a bin — nothing to guard.

  const [producedRow] = await tx
    .select({
      code: storageLocations.code,
      producedKg: sql<number>`
        COALESCE(
          (
            SELECT SUM(${productionRuns.biocharOutputKg})
            FROM ${productionRuns}
            WHERE ${productionRuns.biocharStorageLocationId} = ${storageLocations.id}
          ),
          0
        )
      `,
    })
    .from(storageLocations)
    .where(eq(storageLocations.id, binId));

  if (!producedRow) {
    throw new SafeError("Biochar storage location not found");
  }

  const allocatedConditions = [
    eq(productionRuns.biocharStorageLocationId, binId),
  ];
  if (excludeProductId) {
    allocatedConditions.push(ne(biocharProducts.id, excludeProductId));
  }

  const [allocatedRow] = await tx
    .select({
      allocatedKg: sql<number>`
        COALESCE(
          SUM(
            COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
          ),
          0
        )
      `,
    })
    .from(productionRuns)
    .innerJoin(
      biocharProducts,
      eq(biocharProducts.linkedProductionRunId, productionRuns.id),
    )
    .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
    .where(and(...allocatedConditions));

  const movementDelta = await movementLaneDeltaKg(tx, binId, "biochar");

  const availableKg =
    Number(producedRow.producedKg) -
    Number(allocatedRow?.allocatedKg ?? 0) +
    movementDelta;

  if (requestedBiocharKg > availableKg + STOCK_EPSILON_KG) {
    throw new SafeError(
      `Cannot draw ${formatKg(requestedBiocharKg)} of biochar from bin ${producedRow.code}: only ${formatKg(
        availableKg,
      )} on hand. ${RECONCILE_HINT}`,
    );
  }
}

/**
 * Reject a delivery that would draw more wet mass out of a biochar product than
 * it still holds. Physically-drawn mass is the sum of `delivered` deliveries for
 * the product (matching the picker's remaining-stock derivation); an edited or
 * new delivery is excluded so it doesn't double-count itself.
 */
export async function assertBiocharProductDrawAvailable(
  tx: DbTransaction,
  params: {
    biocharProductId: string;
    requestedWetKg: number;
    excludeDeliveryId?: string;
  },
): Promise<void> {
  const { biocharProductId, requestedWetKg, excludeDeliveryId } = params;
  if (requestedWetKg <= 0) return;

  const [product] = await tx
    .select({ code: biocharProducts.code, massKg: biocharProducts.massKg })
    .from(biocharProducts)
    .where(eq(biocharProducts.id, biocharProductId));

  if (!product) {
    throw new SafeError("Biochar product not found");
  }

  // Delivered wet mass already drawn for this product (a delivery's own product
  // overrides its order's). Only `delivered` rows have physically left the bin.
  const deliveredConditions = [
    eq(deliveries.status, "delivered"),
    sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId}) = ${biocharProductId}`,
  ];
  if (excludeDeliveryId) {
    deliveredConditions.push(ne(deliveries.id, excludeDeliveryId));
  }

  const [deliveredRow] = await tx
    .select({
      deliveredKg: sql<number>`COALESCE(SUM(${deliveries.deliveredWetMassKg}), 0)`,
    })
    .from(deliveries)
    .innerJoin(orders, eq(deliveries.orderId, orders.id))
    .where(and(...deliveredConditions));

  const remainingKg =
    Number(product.massKg ?? 0) - Number(deliveredRow?.deliveredKg ?? 0);

  if (requestedWetKg > remainingKg + STOCK_EPSILON_KG) {
    throw new SafeError(
      `Cannot deliver ${formatKg(requestedWetKg)} from product ${product.code}: only ${formatKg(
        remainingKg,
      )} remain undelivered. Reconcile the source bin or adjust the product before delivering.`,
    );
  }
}
