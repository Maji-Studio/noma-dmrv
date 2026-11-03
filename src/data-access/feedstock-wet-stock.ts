import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { addDaysIso, startOfFacilityDay } from "@/lib/date-utils";
import { formatMassKg } from "@/lib/format-utils";
import { replayFeedstockDraws, FeedstockReplayOverdrawError } from "@/lib/feedstock-draw-replay";
import { replayFeedstockBinStock } from "./feedstock-bin-ledger";
import { getFeedstockMethodChanges } from "./feedstock-bin-method-history";
import { getOutputStockFacilityTimezone } from "./output-stock-dates";
import { isStockOverdraw } from "@/lib/stock-overdraw";
import { deriveLaneStock } from "./lane-stock-derivation";
import { lockBinStock } from "./lock-bin-stocks";
import { overdrawError, StockOverdrawError } from "./stock-overdraw-error";
import { requireOrgScope } from "./utils";

type FeedstockStockReader = Pick<typeof db, "select">;

const EMPTY_FEEDSTOCK_BIN_MESSAGE =
  "held no wet feedstock at the run’s start. Move the run’s start or correct the intake’s delivery date.";

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

async function readFeedstockBinCode(
  ctx: OrgContext,
  executor: FeedstockStockReader,
  storageLocationId: string,
): Promise<string | undefined> {
  requireOrgScope(ctx);
  const [bin] = await executor.select({ code: storageLocations.code }).from(storageLocations).where(and(
    eq(storageLocations.id, storageLocationId),
    eq(storageLocations.organizationId, ctx.organizationId),
  ));
  return bin?.code;
}

/** Convert the pure replay refusal at the data-access boundary. */
export async function throwFeedstockReplayOverdraw(ctx: OrgContext, executor: FeedstockStockReader,
  storageLocationId: string, error: FeedstockReplayOverdrawError): Promise<never> {
  requireOrgScope(ctx);
  const code = await readFeedstockBinCode(ctx, executor, storageLocationId);
  const label = code === undefined ? 'This bin' : `Bin ${code}`;
  const message = error.availableWetKg === 0 ? `${label} ${EMPTY_FEEDSTOCK_BIN_MESSAGE}`
    : `By the run’s start day ${code === undefined ? 'this bin' : `bin ${code}`} held ${formatMassKg(error.availableWetKg)}, less than the ${formatMassKg(error.requestedWetKg)} drawn. Lower the draw or move the run’s start.`;
  throw new StockOverdrawError(message, { storageLocationId, availableWetKg: error.availableWetKg, requestedWetKg: error.requestedWetKg });
}

/** Preview an additional draw at the end of a facility day using saved earlier run shares. */
export async function allocateFeedstockWetMass(ctx: OrgContext, executor: FeedstockStockReader,
  storageLocationId: string, totalWetMassKg: number, cutoffDay: string): Promise<FeedstockWetAllocation[]> {
  requireOrgScope(ctx);
  const [bin] = await executor.select().from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId),
  ));
  if (!bin) throw new StockOverdrawError(`This bin ${EMPTY_FEEDSTOCK_BIN_MESSAGE}`, { storageLocationId, availableWetKg: 0, requestedWetKg: totalWetMassKg });
  const timezone = await getOutputStockFacilityTimezone(ctx, bin.facilityId, executor);
  const end = startOfFacilityDay(addDaysIso(cutoffDay, 1), timezone).getTime() - 1;
  const at = new Date(end).toISOString();
  const ledger = await replayFeedstockBinStock(ctx, storageLocationId, executor);
  const id = 'preview';
  try {
    const replay = replayFeedstockDraws([...ledger.entries.filter(entry => entry.occurredAt <= at).map(entry => ({ ...entry,
      savedShares: entry.kind === 'run_draw' ? ledger.withdrawals.get(entry.id) ?? [] : undefined,
    })), { id, kind: 'run_draw', occurredAt: at, recordedAt: at, wetDeltaKg: -totalWetMassKg }], bin,
    await getFeedstockMethodChanges(ctx, storageLocationId, executor));
    return (replay.withdrawals.get(id) ?? []).map(row => ({ feedstockId: row.feedstockId, wetMassUsedKg: row.wetKg }));
  } catch (error) {
    if (error instanceof FeedstockReplayOverdrawError) return throwFeedstockReplayOverdraw(ctx, executor, storageLocationId, error);
    throw error;
  }
}
