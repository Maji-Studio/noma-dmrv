import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  deriveBiocharAvailableKg,
  isOverdraw,
  overdrawError,
} from "./bin-stock-guards";
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
      throw overdrawError(
        "biochar",
        previous.availableKg,
        additionalDrawKg,
      );
    }
  }
}
