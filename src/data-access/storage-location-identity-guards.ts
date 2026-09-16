/**
 * Stocked-bin identity guard (issue #767).
 *
 * A bin's `type` and `feedstockTypeId` decide which material lane every stock
 * derivation reads for it. Changing either one on a bin that still holds
 * material, or that already carries stock history, silently re-points that
 * history at a lane nobody reads, so the mass disappears from every bin and
 * facility summary without a single movement row to explain it.
 *
 * The guard runs inside the caller's transaction while it holds the bin's
 * stock lock, mirroring `archiveStorageLocation`. Rename, code, capacity and
 * every other metadata field stay editable on a stocked bin: only the two
 * identity columns are fenced.
 *
 * The empty-bin-with-history case is deliberately refused as well. Whether an
 * emptied bin may be repurposed is an open product decision (#767 / #313), and
 * refusing is the reversible half of it.
 */

import { and, count, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  biocharStorageInventory,
  binMovements,
  deliveries,
  feedstocks,
  outputStockAllocations,
  productionRunFeedstockDraws,
  productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { laneForStorageType } from "@/schemas/bin-movements";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { deriveBinLaneAvailableKg, hasNonZeroStock } from "./bin-stock-guards";
import { requireOrgScope } from "./utils";

const STOCK_BLOCKS_MESSAGE =
  "This bin still has stock in its current material lane. Its setup was not " +
  "changed. Review its stock and movement history before changing Storage type.";

const HISTORY_BLOCKS_MESSAGE =
  "This bin has stock history in its current material lane. Its setup was not " +
  "changed. Review its stock and movement history before changing Storage type.";

/** Every table that records mass moving into or out of one bin. */
async function hasStockHistory(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationId: string,
): Promise<boolean> {
  const organizationId = ctx.organizationId;
  const results = await Promise.all([
    tx
      .select({ value: count() })
      .from(feedstocks)
      .where(
        and(
          eq(feedstocks.storageLocationId, storageLocationId),
          eq(feedstocks.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(productionRunFeedstockDraws)
      .where(
        and(
          eq(productionRunFeedstockDraws.storageLocationId, storageLocationId),
          eq(productionRunFeedstockDraws.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(productionRuns)
      .where(
        and(
          eq(productionRuns.biocharStorageLocationId, storageLocationId),
          eq(productionRuns.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(biocharProducts)
      .where(
        and(
          eq(biocharProducts.storageLocationId, storageLocationId),
          eq(biocharProducts.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(biocharProducts)
      .where(
        and(
          eq(biocharProducts.sourceBiocharStorageLocationId, storageLocationId),
          eq(biocharProducts.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(biocharProductSourceAllocations)
      .where(
        and(
          eq(
            biocharProductSourceAllocations.sourceStorageLocationId,
            storageLocationId,
          ),
          eq(biocharProductSourceAllocations.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.storageLocationId, storageLocationId),
          eq(deliveries.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(biocharStorageInventory)
      .where(
        and(
          eq(biocharStorageInventory.storageLocationId, storageLocationId),
          eq(biocharStorageInventory.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(binMovements)
      .where(
        and(
          eq(binMovements.storageLocationId, storageLocationId),
          eq(binMovements.organizationId, organizationId),
        ),
      ),
    tx
      .select({ value: count() })
      .from(outputStockAllocations)
      .where(
        and(
          eq(outputStockAllocations.sourceStorageLocationId, storageLocationId),
          eq(outputStockAllocations.organizationId, organizationId),
        ),
      ),
  ]);

  return results.some(([row]) => Number(row.value) > 0);
}

/**
 * Refuse a `type` or `feedstockTypeId` change on a bin that still holds stock
 * or already carries stock history. Call it under the bin's stock lock, after
 * re-reading the effective row, and only when one of those two columns moves.
 */
export async function assertBinIdentityChangeAllowed(
  ctx: OrgContext,
  tx: DbTransaction,
  bin: { id: string; type: StorageLocationType },
): Promise<void> {
  requireOrgScope(ctx);

  const availableKg = await deriveBinLaneAvailableKg(
    ctx,
    tx,
    bin.id,
    laneForStorageType(bin.type),
  );
  if (hasNonZeroStock(availableKg)) {
    throw new SafeError(STOCK_BLOCKS_MESSAGE);
  }

  if (await hasStockHistory(ctx, tx, bin.id)) {
    throw new SafeError(HISTORY_BLOCKS_MESSAGE);
  }
}
