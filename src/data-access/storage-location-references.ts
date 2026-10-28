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

import { and, count, eq, inArray } from "drizzle-orm";
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
 * Every table that points at a bin, with the noun the delete refusal shows.
 * Both the single-bin guard count and the batched screen read walk this one
 * list, so a table added here reaches both.
 */
const REFERENCE_SOURCES = [
  { blocker: "feedstock batches", table: feedstocks, bin: feedstocks.storageLocationId, org: feedstocks.organizationId },
  { blocker: "production runs using it as a feedstock bin", table: productionRunFeedstockDraws, bin: productionRunFeedstockDraws.storageLocationId, org: productionRunFeedstockDraws.organizationId },
  { blocker: "production runs using it as a biochar bin", table: productionRuns, bin: productionRuns.biocharStorageLocationId, org: productionRuns.organizationId },
  { blocker: "biochar products stored in it", table: biocharProducts, bin: biocharProducts.storageLocationId, org: biocharProducts.organizationId },
  { blocker: "biochar products sourced from it", table: biocharProducts, bin: biocharProducts.sourceBiocharStorageLocationId, org: biocharProducts.organizationId },
  { blocker: "product source allocations drawing from it", table: biocharProductSourceAllocations, bin: biocharProductSourceAllocations.sourceStorageLocationId, org: biocharProductSourceAllocations.organizationId },
  { blocker: "deliveries drawing from it", table: deliveries, bin: deliveries.storageLocationId, org: deliveries.organizationId },
  { blocker: "storage inventory records", table: biocharStorageInventory, bin: biocharStorageInventory.storageLocationId, org: biocharStorageInventory.organizationId },
  { blocker: "reconciliation or movement history", table: binMovements, bin: binMovements.storageLocationId, org: binMovements.organizationId },
  { blocker: "output bin layer records", table: outputStockAllocations, bin: outputStockAllocations.sourceStorageLocationId, org: outputStockAllocations.organizationId },
] as const;

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
  const counts = await Promise.all(REFERENCE_SOURCES.map((source) =>
    tx
      .select({ value: count() })
      .from(source.table)
      .where(and(eq(source.bin, storageLocationId), eq(source.org, ctx.organizationId))),
  ));
  return REFERENCE_SOURCES.map((source, index) => ({
    blocker: source.blocker,
    count: Number(counts[index][0]?.value ?? 0),
  }));
}

/**
 * `countStorageLocationReferences` for many bins at once: one grouped query
 * per reference table, whatever the number of bins (the storage board).
 */
export async function countStorageLocationReferencesForBins(
  ctx: OrgContext,
  tx: DbReader,
  storageLocationIds: readonly string[],
): Promise<Map<string, StorageLocationReference[]>> {
  requireOrgScope(ctx);
  const ids = [...new Set(storageLocationIds)];
  if (ids.length === 0) return new Map();
  const grouped = await Promise.all(REFERENCE_SOURCES.map((source) =>
    tx
      .select({ binId: source.bin, value: count() })
      .from(source.table)
      .where(and(inArray(source.bin, ids), eq(source.org, ctx.organizationId)))
      .groupBy(source.bin),
  ));
  return new Map(ids.map((id) => [id, REFERENCE_SOURCES.map((source, index) => ({
    blocker: source.blocker,
    count: Number(grouped[index].find((row) => row.binId === id)?.value ?? 0),
  }))]));
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
