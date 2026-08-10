import { and, eq, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

const STOCK_LOCK_RETRY_MESSAGE =
  "Stock changed while this operation was being prepared. Refresh and retry.";
const BIN_STOCK_LOCK_SCOPE = "bin-stock";
const ADVISORY_LOCK_HASH_SEED = 0;

/** Serialize stock read-modify-write operations for one physical bin. */
export async function lockBinStock(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const lockKey = `${BIN_STOCK_LOCK_SCOPE}:${ctx.organizationId}:${storageLocationId}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, ${ADVISORY_LOCK_HASH_SEED}))`,
  );
  const [bin] = await tx
    .select({ archivedAt: storageLocations.archivedAt })
    .from(storageLocations)
    .where(
      and(
        eq(storageLocations.id, storageLocationId),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    );
  // Some stock flows deliberately use a product ID as a fallback advisory-lock
  // key when no physical bin exists. The caller validates missing rows; an
  // actual archived bin must never accept a stock write.
  if (bin?.archivedAt) {
    throw new SafeError("Storage bin not found or archived");
  }
}

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
