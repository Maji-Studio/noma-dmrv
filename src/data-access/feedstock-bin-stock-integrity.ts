/**
 * Post-write feedstock lane integrity (issue #767).
 *
 * A feedstock bin's stock is derived (`deriveLaneStock`) and deliberately
 * unclamped, so a write that shrinks or moves an intake after withdrawals were
 * recorded can leave the lane below zero. Validating the bin reference is not
 * enough: the mass itself has to be re-derived once the new row is visible.
 *
 * Every feedstock write that can shrink a lane calls this after its own UPDATE
 * or DELETE, inside the same transaction, while it still holds each affected
 * bin's stock lock (`lockBinStocks`). A negative lane rolls the whole
 * transaction back.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { ActionConflictError } from "@/lib/errors";
import { isStockOverdraw } from "@/lib/stock-overdraw";
import { deriveFeedstockWetStockKg } from "./feedstock-wet-stock";
import { requireOrgScope } from "./utils";

/** Which write is being refused, so the message names the right action. */
export type FeedstockStockWrite = "save" | "delete";

const NEGATIVE_LANE_MESSAGE: Record<FeedstockStockWrite, string> = {
  save:
    "Feedstock was not saved because this change would make the bin's stock negative. " +
    "Review its intake and withdrawals.",
  delete:
    "Feedstock was not deleted because this change would make the bin's stock negative. " +
    "Review its intake and withdrawals.",
};

const CONFLICT_ENTITY = "storageLocation";

/** True when a derived lane sits materially below zero. */
function isNegativeStock(availableKg: number): boolean {
  return isStockOverdraw(0, availableKg);
}

/**
 * Refuse the transaction when any of these bins now derives a negative wet
 * feedstock lane. The conflict carries the offending bin so the UI can link it.
 * A reduction that lands on exactly zero passes.
 */
export async function assertFeedstockBinLanesNotNegative(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationIds: ReadonlyArray<string | null | undefined>,
  write: FeedstockStockWrite,
): Promise<void> {
  requireOrgScope(ctx);
  const binIds = [
    ...new Set(storageLocationIds.filter((id): id is string => id != null)),
  ];
  if (binIds.length === 0) return;

  const bins = await tx
    .select({ id: storageLocations.id, code: storageLocations.code })
    .from(storageLocations)
    .where(
      and(
        inArray(storageLocations.id, binIds),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    );

  for (const bin of bins) {
    const availableWetKg = await deriveFeedstockWetStockKg(ctx, tx, bin.id);
    if (isNegativeStock(availableWetKg)) {
      throw new ActionConflictError(NEGATIVE_LANE_MESSAGE[write], {
        entity: CONFLICT_ENTITY,
        id: bin.id,
        code: bin.code,
      });
    }
  }
}
