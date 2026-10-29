import { and, asc, eq, gt, lt } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { feedstocks, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { addDaysIso } from "@/lib/date-utils";
import { formatMassKg } from "@/lib/format-utils";
import { SafeError } from "@/lib/errors";
import { isStockOverdraw } from "@/lib/stock-overdraw";
import { deriveLaneStock } from "./lane-stock-derivation";
import { lockBinStock } from "./lock-bin-stocks";
import { overdrawError, StockOverdrawError } from "./stock-overdraw-error";
import { requireOrgScope } from "./utils";

type FeedstockStockReader = Pick<typeof db, "select">;

const MASS_PRECISION_FACTOR = 1_000;
const EMPTY_FEEDSTOCK_BIN_MESSAGE =
  "has no complete intake with wet mass delivered by the run’s start day. Move the run’s start or correct the intake’s delivery date.";

export interface FeedstockWetAllocation {
  feedstockId: string;
  wetMassUsedKg: number;
}

/** Authoritative wet/as-received feedstock stock for one bin. */
export async function deriveFeedstockWetStockKg(
  ctx: OrgContext,
  executor: FeedstockStockReader,
  storageLocationId: string,
  options: { excludeRunId?: string; excludeProductId?: string } = {},
): Promise<number> {
  requireOrgScope(ctx);
  const [stock] = await deriveLaneStock(ctx, executor, {
    storageLocationIds: [storageLocationId],
    ...options,
    lanes: "feedstock",
  });
  return stock?.feedstockStockWetKg ?? 0;
}

/** Hard-block a wet feedstock withdrawal while holding the bin lock. */
export async function assertFeedstockWetDrawWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    storageLocationId: string;
    requestedWetKg: number;
    excludeRunId?: string;
    excludeProductId?: string;
    binLockAlreadyHeld?: boolean;
  },
): Promise<void> {
  requireOrgScope(ctx);
  if (!params.binLockAlreadyHeld) {
    await lockBinStock(ctx, tx, params.storageLocationId);
  }
  const availableWetKg = await deriveFeedstockWetStockKg(
    ctx,
    tx,
    params.storageLocationId,
    {
      excludeRunId: params.excludeRunId,
      excludeProductId: params.excludeProductId,
    },
  );
  if (isStockOverdraw(params.requestedWetKg, availableWetKg)) {
    throw overdrawError("feedstock", { storageLocationId: params.storageLocationId, availableWetKg, requestedWetKg: params.requestedWetKg });
  }
}

function toMassUnits(value: number): number {
  const units = Math.round(value * MASS_PRECISION_FACTOR);
  if (!Number.isSafeInteger(units)) {
    throw new SafeError("Feedstock mass is too large to allocate safely");
  }
  return units;
}

/**
 * Allocate a run's wet withdrawal across complete intake batches in proportion
 * to their recorded wet mass. Integer gram arithmetic keeps the persisted
 * allocations exact at numeric(14,3) precision.
 */
export async function allocateFeedstockWetMass(
  ctx: OrgContext,
  executor: FeedstockStockReader,
  storageLocationId: string,
  totalWetMassKg: number,
  cutoffDay: string,
): Promise<FeedstockWetAllocation[]> {
  requireOrgScope(ctx);
  const batches = await executor
    .select({
      id: feedstocks.id,
      massWetKg: feedstocks.massWetKg,
    })
    .from(feedstocks)
    .where(
      and(
        eq(feedstocks.storageLocationId, storageLocationId),
        eq(feedstocks.organizationId, ctx.organizationId),
        eq(feedstocks.status, "complete"),
        gt(feedstocks.massWetKg, 0),
        // Delivery timestamps encode calendar dates, not facility instants.
        lt(feedstocks.deliveryDate, new Date(`${addDaysIso(cutoffDay, 1)}T00:00:00Z`)),
      ),
    )
    .orderBy(asc(feedstocks.id));

  const weights = batches.map((batch) => toMassUnits(batch.massWetKg ?? 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) {
    const [bin] = await executor.select({ name: storageLocations.name }).from(storageLocations).where(and(
      eq(storageLocations.id, storageLocationId),
      eq(storageLocations.organizationId, ctx.organizationId),
    ));
    const label = bin?.name?.trim() ? `Bin ${bin.name}` : "This bin";
    throw new StockOverdrawError(`${label} ${EMPTY_FEEDSTOCK_BIN_MESSAGE}`, { storageLocationId, availableWetKg: 0, requestedWetKg: totalWetMassKg });
  }

  const totalUnits = toMassUnits(totalWetMassKg);
  const availableWetKg = totalWeight / MASS_PRECISION_FACTOR;
  if (totalUnits > totalWeight) {
    throw new StockOverdrawError(
      `By the run's start day this bin had received ${formatMassKg(availableWetKg)}, less than the ${formatMassKg(totalWetMassKg)} drawn. Lower the draw or move the run's start.`,
      { storageLocationId, availableWetKg, requestedWetKg: totalWetMassKg },
    );
  }

  let allocatedUnits = 0;
  return batches.map((batch, index) => {
    const units =
      index === batches.length - 1
        ? totalUnits - allocatedUnits
        : Math.floor((weights[index] / totalWeight) * totalUnits);
    allocatedUnits += units;
    return {
      feedstockId: batch.id,
      wetMassUsedKg: units / MASS_PRECISION_FACTOR,
    };
  });
}
