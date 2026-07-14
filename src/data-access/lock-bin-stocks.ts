import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { lockBinStock } from "./bin-stock-guards";

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
