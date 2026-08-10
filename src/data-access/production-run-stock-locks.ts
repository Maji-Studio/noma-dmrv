import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  deriveBiocharAvailableKg,
  isOverdraw,
  overdrawError,
} from "./bin-stock-guards";
import { assertFeedstockWetDrawWithinStock } from "./feedstock-wet-stock";
import {
  assertStockLockSnapshot,
  lockBinStocks,
} from "./lock-bin-stocks";

interface ProductionRunStockSnapshot {
  feedstockStorageLocationId: string | null;
  biocharStorageLocationId: string | null;
}

interface ProductionRunStockUpdate {
  feedstockStorageLocationId?: string | null;
  feedstockWetMassKg?: number | null;
  feedstockMoisturePercent?: number | null;
  biocharStorageLocationId?: string | null;
  biocharOutputKg?: number | null;
}

interface BiocharBinStockState {
  storageLocationId: string;
  availableKg: number;
}

/** Hard-block a new run's feedstock draw against its source bin. */
export async function assertProductionRunCreateFeedstockDrawWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    storageLocationId: string;
    requestedWetKg: number;
  },
): Promise<void> {
  await assertFeedstockWetDrawWithinStock(ctx, tx, {
    storageLocationId: params.storageLocationId,
    requestedWetKg: params.requestedWetKg,
  });
}

/** Discover the complete affected bin set and lock it before the run row. */
export async function lockProductionRunUpdateStock(
  ctx: OrgContext,
  tx: DbTransaction,
  snapshot: ProductionRunStockSnapshot,
  data: ProductionRunStockUpdate,
): Promise<void> {
  const feedstockStockChanged =
    data.feedstockStorageLocationId !== undefined ||
    data.feedstockWetMassKg !== undefined ||
    data.feedstockMoisturePercent !== undefined;
  const biocharStockChanged =
    data.biocharStorageLocationId !== undefined ||
    data.biocharOutputKg !== undefined;

  await lockBinStocks(ctx, tx, [
    ...(feedstockStockChanged
      ? [
          snapshot.feedstockStorageLocationId,
          data.feedstockStorageLocationId ?? snapshot.feedstockStorageLocationId,
        ]
      : []),
    ...(biocharStockChanged
      ? [
          snapshot.biocharStorageLocationId,
          data.biocharStorageLocationId ?? snapshot.biocharStorageLocationId,
        ]
      : []),
  ]);
}

/** Reject a discovery read invalidated while its bin batch was acquired. */
export function assertProductionRunStockSnapshot(
  snapshot: ProductionRunStockSnapshot,
  locked: ProductionRunStockSnapshot,
  data: ProductionRunStockUpdate,
): void {
  const feedstockStockChanged =
    data.feedstockStorageLocationId !== undefined ||
    data.feedstockWetMassKg !== undefined ||
    data.feedstockMoisturePercent !== undefined;
  const biocharStockChanged =
    data.biocharStorageLocationId !== undefined ||
    data.biocharOutputKg !== undefined;

  assertStockLockSnapshot(
    (!feedstockStockChanged ||
      snapshot.feedstockStorageLocationId ===
        locked.feedstockStorageLocationId) &&
      (!biocharStockChanged ||
        snapshot.biocharStorageLocationId ===
          locked.biocharStorageLocationId),
  );
}

/** Snapshot affected biochar lanes after the caller's sorted lock batch. */
export async function deriveProductionRunBiocharStockState(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationIds: ReadonlyArray<string | null>,
): Promise<BiocharBinStockState[]> {
  const uniqueIds = [...new Set(
    storageLocationIds.filter((id): id is string => id != null),
  )];
  const stockState: BiocharBinStockState[] = [];
  for (const storageLocationId of uniqueIds) {
    stockState.push({
      storageLocationId,
      availableKg: await deriveBiocharAvailableKg(
        ctx,
        tx,
        storageLocationId,
      ),
    });
  }
  return stockState;
}

/** Snapshot biochar lanes only when a run update changes their stock. */
export async function deriveProductionRunUpdateBiocharStockState(
  ctx: OrgContext,
  tx: DbTransaction,
  locked: {
    biocharStorageLocationId: string | null;
    biocharOutputKg: number | null;
  },
  data: Pick<
    ProductionRunStockUpdate,
    "biocharStorageLocationId" | "biocharOutputKg"
  >,
): Promise<BiocharBinStockState[]> {
  const biocharStockChanged =
    (data.biocharOutputKg !== undefined &&
      data.biocharOutputKg !== locked.biocharOutputKg) ||
    (data.biocharStorageLocationId !== undefined &&
      data.biocharStorageLocationId !== locked.biocharStorageLocationId);
  if (!biocharStockChanged) return [];

  const effectiveBiocharStorageId =
    data.biocharStorageLocationId !== undefined
      ? data.biocharStorageLocationId
      : locked.biocharStorageLocationId;
  return deriveProductionRunBiocharStockState(ctx, tx, [
    locked.biocharStorageLocationId,
    effectiveBiocharStorageId,
  ]);
}

/** Re-derive changed run lanes and reject any incremental overdraw. */
export async function assertProductionRunBiocharStockNotOverdrawn(
  ctx: OrgContext,
  tx: DbTransaction,
  stockState: ReadonlyArray<BiocharBinStockState>,
): Promise<void> {
  for (const previous of stockState) {
    const transactionAvailableKg = await deriveBiocharAvailableKg(
      ctx,
      tx,
      previous.storageLocationId,
    );
    const additionalDrawKg = previous.availableKg - transactionAvailableKg;
    if (
      additionalDrawKg > 0 &&
      isOverdraw(additionalDrawKg, previous.availableKg)
    ) {
      throw overdrawError("biochar");
    }
  }
}

/** Validate a replacement run allocation while its source-bin lock is held. */
export async function assertProductionRunUpdateFeedstockDrawWithinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    productionRunId: string;
    storageLocationId: string;
    requestedWetKg: number;
  },
): Promise<void> {
  await assertFeedstockWetDrawWithinStock(ctx, tx, {
    storageLocationId: params.storageLocationId,
    requestedWetKg: params.requestedWetKg,
    excludeRunId: params.productionRunId,
    binLockAlreadyHeld: true,
  });
}
