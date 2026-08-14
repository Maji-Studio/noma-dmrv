import { and, asc, eq, gt } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { feedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { isStockOverdraw } from "@/lib/stock-overdraw";
import { deriveLaneStock } from "./lane-stock-derivation";
import { lockBinStock } from "./lock-bin-stocks";
import { overdrawError } from "./stock-overdraw-error";
import { requireOrgScope } from "./utils";

type FeedstockStockReader = Pick<typeof db, "select">;

const MASS_PRECISION_FACTOR = 1_000;
const EMPTY_FEEDSTOCK_BIN_MESSAGE =
  "Selected feedstock bin has no complete feedstock batches with wet mass";

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
    throw overdrawError("feedstock");
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
      ),
    )
    .orderBy(asc(feedstocks.id));

  if (batches.length === 0) {
    throw new SafeError(EMPTY_FEEDSTOCK_BIN_MESSAGE);
  }

  const totalUnits = toMassUnits(totalWetMassKg);
  const weights = batches.map((batch) => toMassUnits(batch.massWetKg ?? 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) {
    throw new SafeError(EMPTY_FEEDSTOCK_BIN_MESSAGE);
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
