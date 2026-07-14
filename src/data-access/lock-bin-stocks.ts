import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { lockBinStock } from "./bin-stock-guards";

const STOCK_LOCK_RETRY_MESSAGE =
  "Stock changed while this operation was being prepared. Refresh and retry.";

export async function lockBinStocks(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const sortedIds = [...new Set(
    storageLocationIds.filter((id): id is string => id != null),
  )].sort();

  for (const storageLocationId of sortedIds) {
    await lockBinStock(ctx, tx, storageLocationId);
  }
}

/** Abort when a pre-lock discovery read no longer matches the locked rows. */
export function assertStockLockSnapshot(condition: boolean): void {
  if (!condition) {
    throw new SafeError(STOCK_LOCK_RETRY_MESSAGE);
  }
}
