import type { DbTransaction } from "@/db";
import { getOutputBinDryBalance } from "./output-stock";
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
  feedstockStorageLocationIds: readonly string[];
  biocharStorageLocationId: string | null;
}

interface ProductionRunStockUpdate {
  facilityId?: string;
  feedstockDraws?: ReadonlyArray<{ storageLocationId: string }>;
  biocharStorageLocationId?: string | null;
  biocharOutputKg?: number | null;
  biocharMoisturePercent?: number | null;
  endTime?: Date | null;
  status?: string;
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
    data.feedstockDraws !== undefined || data.facilityId !== undefined;

  await lockBinStocks(ctx, tx, [
    ...(feedstockStockChanged
      ? [
          ...snapshot.feedstockStorageLocationIds,
          ...(data.feedstockDraws?.map((draw) => draw.storageLocationId) ??
            snapshot.feedstockStorageLocationIds),
        ]
      : []),
    snapshot.biocharStorageLocationId,
    data.biocharStorageLocationId ?? snapshot.biocharStorageLocationId,
  ]);
}

/** Reject a discovery read invalidated while its bin batch was acquired. */
export function assertProductionRunStockSnapshot(
  snapshot: ProductionRunStockSnapshot,
  locked: ProductionRunStockSnapshot,
  data: ProductionRunStockUpdate,
): void {
  const feedstockStockChanged =
    data.feedstockDraws !== undefined || data.facilityId !== undefined;

  assertStockLockSnapshot(
    (!feedstockStockChanged ||
      snapshot.feedstockStorageLocationIds.length ===
        locked.feedstockStorageLocationIds.length &&
      snapshot.feedstockStorageLocationIds.every(
        (id, index) => id === locked.feedstockStorageLocationIds[index],
      )) &&
      snapshot.biocharStorageLocationId === locked.biocharStorageLocationId,
  );
}

/** Snapshot affected biochar lanes after the caller's sorted lock batch. */
export async function deriveProductionRunBiocharStockState(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationIds: ReadonlyArray<string | null>,
  excludeUnresolvedRunId?: string,
): Promise<BiocharBinStockState[]> {
  const uniqueIds = [...new Set(
    storageLocationIds.filter((id): id is string => id != null),
  )];
  const stockState: BiocharBinStockState[] = [];
  for (const storageLocationId of uniqueIds) {
    stockState.push({
      storageLocationId,
      availableKg: await getOutputBinDryBalance(ctx, storageLocationId, tx, { excludeUnresolvedRunId }),
    });
  }
  return stockState;
}

/** Snapshot biochar lanes only when a run update changes their stock. */
export async function deriveProductionRunUpdateBiocharStockState(
  ctx: OrgContext,
  tx: DbTransaction,
  locked: {
    id: string;
    biocharDryMassKg: number | null;
    endTime: Date | null;
    biocharStorageLocationId: string | null;
    biocharOutputKg: number | null;
  },
  data: Pick<
    ProductionRunStockUpdate,
    "biocharStorageLocationId" | "biocharOutputKg" | "biocharMoisturePercent" | "endTime" | "status"
  >,
): Promise<BiocharBinStockState[]> {
  const biocharStockChanged =
    data.biocharMoisturePercent !== undefined || data.endTime !== undefined || data.status !== undefined ||
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
  ], locked.biocharDryMassKg == null || !Number.isFinite(locked.biocharDryMassKg) || locked.biocharDryMassKg <= 0 || locked.endTime == null ? locked.id : undefined);
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
