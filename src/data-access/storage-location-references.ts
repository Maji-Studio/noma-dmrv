/**
 * Every table that records mass moving into or out of one storage bin.
 *
 * Two guards need this same list: `deleteStorageLocation` refuses to drop a bin
 * that anything still points at, and the stocked-bin identity guard (#767)
 * refuses a `type` or `feedstockTypeId` change on a bin that already carries
 * history. They used to keep separate copies and drifted, so a table added for
 * one guard was invisible to the other. Both read the list from here instead.
 *
 * Each entry carries the noun the delete refusal shows the operator, so adding a
 * table means adding one row and both guards see it.
 */

import { and, count, eq } from "drizzle-orm";
import type { db } from "@/db";
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
import { requireOrgScope } from "./utils";

/** Any Drizzle client that can run reads: the live `db` or a transaction. */
type DbReader = Pick<typeof db, "select">;

/** One reference kind, named as the delete refusal names it to the operator. */
export interface StorageLocationReference {
  readonly blocker: string;
  readonly count: number;
}

/**
 * Count every row that still points at one bin, org-scoped.
 *
 * Pass the caller's transaction when the answer has to be consistent with a
 * lock the caller already holds; pass `db` for a one-off read.
 */
export async function countStorageLocationReferences(
  ctx: OrgContext,
  tx: DbReader,
  storageLocationId: string,
): Promise<StorageLocationReference[]> {
  requireOrgScope(ctx);
  const organizationId = ctx.organizationId;

  const [
    [{ value: feedstockCount }],
    [{ value: feedstockRunCount }],
    [{ value: biocharRunCount }],
    [{ value: productCount }],
    [{ value: sourcedProductCount }],
    [{ value: sourceAllocationCount }],
    [{ value: deliveryCount }],
    [{ value: inventoryCount }],
    [{ value: movementCount }],
    [{ value: outputAllocationCount }],
  ] = await Promise.all([
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

  return [
    { blocker: "feedstock batches", count: Number(feedstockCount) },
    {
      blocker: "production runs using it as a feedstock bin",
      count: Number(feedstockRunCount),
    },
    {
      blocker: "production runs using it as a biochar bin",
      count: Number(biocharRunCount),
    },
    { blocker: "biochar products stored in it", count: Number(productCount) },
    {
      blocker: "biochar products sourced from it",
      count: Number(sourcedProductCount),
    },
    {
      blocker: "product source allocations drawing from it",
      count: Number(sourceAllocationCount),
    },
    { blocker: "deliveries drawing from it", count: Number(deliveryCount) },
    { blocker: "storage inventory records", count: Number(inventoryCount) },
    {
      blocker: "reconciliation or movement history",
      count: Number(movementCount),
    },
    {
      blocker: "output bin layer records",
      count: Number(outputAllocationCount),
    },
  ];
}

/** The operator-facing nouns for every reference kind that still has rows. */
export function storageLocationBlockers(
  references: readonly StorageLocationReference[],
): string[] {
  return references
    .filter((reference) => reference.count > 0)
    .map((reference) => reference.blocker);
}

/** True when anything at all still points at the bin. */
export function hasStorageLocationReferences(
  references: readonly StorageLocationReference[],
): boolean {
  return references.some((reference) => reference.count > 0);
}
