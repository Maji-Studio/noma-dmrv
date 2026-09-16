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

import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { laneForStorageType } from "@/schemas/bin-movements";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { deriveBinLaneAvailableKg, hasNonZeroStock } from "./bin-stock-guards";
import {
  countStorageLocationReferences,
  hasStorageLocationReferences,
} from "./storage-location-references";
import { requireOrgScope } from "./utils";

/**
 * Field labels, exactly as the storage bin form shows them, so the refusal
 * names the control the operator just changed.
 */
const STORAGE_TYPE_FIELD = "Storage type";
const FEEDSTOCK_TYPE_FIELD = "Feedstock type";

/** The bin identity columns a stock derivation reads. */
interface BinIdentity {
  type: StorageLocationType;
  feedstockTypeId: string | null;
}

/**
 * The first sentence is quoted from #767. The closing sentence names whichever
 * field actually moved, so a feedstock-type edit is not told to review a
 * Storage type it never touched.
 */
function stockBlocksMessage(changedField: string): string {
  return (
    "This bin still has stock in its current material lane. Its setup was not " +
    `changed. Review its stock and movement history before changing ${changedField}.`
  );
}

function historyBlocksMessage(changedField: string): string {
  return (
    "This bin has stock history. Its setup was not changed. Review its stock " +
    `and movement history before changing ${changedField}.`
  );
}

/**
 * Name the field the operator moved, or null when the identity is unchanged.
 * A storage-type change clears the feedstock type by itself, so the type wins:
 * naming both would report a field the operator never touched.
 */
function changedIdentityField(
  current: BinIdentity,
  next: BinIdentity,
): string | null {
  if (current.type !== next.type) return STORAGE_TYPE_FIELD;
  if (current.feedstockTypeId !== next.feedstockTypeId) {
    return FEEDSTOCK_TYPE_FIELD;
  }
  return null;
}

/**
 * Refuse a `type` or `feedstockTypeId` change on a bin that still holds stock
 * or already carries stock history. Call it under the bin's stock lock, after
 * re-reading the effective row; it returns without a query when neither
 * identity column moves.
 */
export async function assertBinIdentityChangeAllowed(
  ctx: OrgContext,
  tx: DbTransaction,
  bin: BinIdentity & { id: string },
  next: BinIdentity,
): Promise<void> {
  requireOrgScope(ctx);

  const changedField = changedIdentityField(bin, next);
  if (!changedField) return;

  const availableKg = await deriveBinLaneAvailableKg(
    ctx,
    tx,
    bin.id,
    laneForStorageType(bin.type),
  );
  if (hasNonZeroStock(availableKg)) {
    throw new SafeError(stockBlocksMessage(changedField));
  }

  const references = await countStorageLocationReferences(ctx, tx, bin.id);
  if (hasStorageLocationReferences(references)) {
    throw new SafeError(historyBlocksMessage(changedField));
  }
}
