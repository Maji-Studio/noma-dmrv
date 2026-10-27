import type { DbTransaction } from "@/db";
import { certifierRemovals, creditBatchProductionRuns, feedstocks, feedstockTypes, productionRunFeedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray } from "drizzle-orm";
import {
  getLockedCertifiedLineageForBatches,
  getRecordLocks,
  isSubmittedLineageRow,
} from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

export interface FeedstockTypeLinkLock {
  locked: boolean;
  removals: { id: string; label?: string; facilityId: string }[];
}

/** Each Removal opens on its own facility's list, which may not be the one selected. */
async function withRemovalFacilities(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select">,
  labels: ReadonlyMap<string, string | undefined>,
): Promise<FeedstockTypeLinkLock["removals"]> {
  if (!labels.size) return [];
  const rows = await tx
    .select({ id: certifierRemovals.id, facilityId: certifierRemovals.facilityId })
    .from(certifierRemovals)
    .where(and(
      eq(certifierRemovals.organizationId, ctx.organizationId),
      inArray(certifierRemovals.id, [...labels.keys()]),
    ));
  return rows
    .map(row => ({ id: row.id, facilityId: row.facilityId, ...(labels.get(row.id) ? { label: labels.get(row.id) } : {}) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Advisory read, also used inside the feedstock-type update transaction. */
export async function getFeedstockTypeLinkLock(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select" | "selectDistinct">,
  feedstockTypeId: string,
): Promise<FeedstockTypeLinkLock> {
  requireOrgScope(ctx);
  const [type] = await tx
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(and(
      eq(feedstockTypes.id, feedstockTypeId),
      eq(feedstockTypes.organizationId, ctx.organizationId),
    ));
  if (!type) throw new SafeError("Feedstock type not found.");

  const runs = await tx
    .selectDistinct({ id: productionRunFeedstocks.productionRunId })
    .from(productionRunFeedstocks)
    .innerJoin(feedstocks, and(
      eq(feedstocks.id, productionRunFeedstocks.feedstockId),
      eq(feedstocks.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      eq(feedstocks.feedstockTypeId, feedstockTypeId),
    ))
    .orderBy(productionRunFeedstocks.productionRunId);

  // Resolve registry facts once for all runs, rather than once per run.
  const locks = await getRecordLocks(ctx, tx, runs.map(run => ({
    entityType: "productionRun",
    entityId: run.id,
  })), { sentOnly: true });
  const removals = new Map<string, string | undefined>();
  for (const lock of locks) {
    if (lock.level !== "sent") continue;
    for (const holder of lock.heldBy) {
      if (holder.kind === "removal") removals.set(holder.id, holder.label);
    }
  }
  return {
    locked: locks.some(lock => lock.level === "sent"),
    removals: await withRemovalFacilities(ctx, tx, removals),
  };
}

/**
 * The write-path counterpart: resolves the credit batches of the type's runs,
 * then locks every Removal and GHG Statement they reach in one sorted pass and
 * re-reads under those locks, so a Removal sent at the same moment cannot slip
 * past. Call it inside the transaction that changes the link.
 */
export async function getLockedFeedstockTypeLinkLock(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockTypeId: string,
): Promise<FeedstockTypeLinkLock> {
  requireOrgScope(ctx);
  const batches = await tx
    .selectDistinct({ id: creditBatchProductionRuns.creditBatchId })
    .from(creditBatchProductionRuns)
    .innerJoin(productionRunFeedstocks, and(
      eq(productionRunFeedstocks.productionRunId, creditBatchProductionRuns.productionRunId),
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
    ))
    .innerJoin(feedstocks, and(
      eq(feedstocks.id, productionRunFeedstocks.feedstockId),
      eq(feedstocks.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      eq(feedstocks.feedstockTypeId, feedstockTypeId),
    ))
    .orderBy(creditBatchProductionRuns.creditBatchId);
  const lineage = await getLockedCertifiedLineageForBatches(ctx, tx, batches.map(batch => batch.id));
  const removals = new Map<string, string | undefined>();
  for (const row of lineage.filter(isSubmittedLineageRow)) {
    removals.set(row.removalId, row.recordLockRemoval.label);
  }
  return {
    locked: removals.size > 0,
    removals: await withRemovalFacilities(ctx, tx, removals),
  };
}
