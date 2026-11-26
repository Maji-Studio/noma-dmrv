import { FAILED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { synchronizeFailedEmissionBatches } from "./failed-run-emission-write-guard";
import { loadRunEmissionContributors } from "./credit-batch-emission-contributors";
import type { DbTransaction } from "@/db";
import { certifierRemovals, creditBatchProductionRuns, feedstocks, feedstockTypes, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray } from "drizzle-orm";
import {
  getLineageUnderLockedArtifacts,
  tryLockCertifiedLineageArtifacts,
  getRecordLocks,
  isSubmittedLineageRow,
} from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

export interface FeedstockTypeLinkLock {
  locked: boolean;
  removals: { id: string; code: string; facilityId: string }[];
}

/** Each Removal opens on its own facility's list, which may not be the one selected. */
async function withRemovalFacilities(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select">,
  removalIds: Iterable<string>,
): Promise<FeedstockTypeLinkLock["removals"]> {
  const ids = [...new Set(removalIds)];
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: certifierRemovals.id, code: certifierRemovals.code, facilityId: certifierRemovals.facilityId })
    .from(certifierRemovals)
    .where(and(
      eq(certifierRemovals.organizationId, ctx.organizationId),
      inArray(certifierRemovals.id, ids),
    ));
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** Advisory read for the edit sheet only; writes use getLockedFeedstockTypeLinkLock. */
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
  const removals = new Set<string>();
  for (const lock of locks) {
    if (lock.level !== "sent") continue;
    for (const holder of lock.heldBy) {
      if (holder.kind === "removal") removals.add(holder.id);
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
  const failedRuns = await tx.selectDistinct({ id: productionRunFeedstocks.productionRunId })
    .from(productionRunFeedstocks).innerJoin(feedstocks, and(
      eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId),
    )).innerJoin(productionRuns, and(
      eq(productionRuns.id, productionRunFeedstocks.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.status, FAILED_PRODUCTION_RUN_STATUS),
    )).where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(feedstocks.feedstockTypeId, feedstockTypeId)));
  const contributors = await loadRunEmissionContributors(ctx, failedRuns.map(run => run.id), tx, { includeArchived: true });
  const batchIds = [...new Set([...batches.map(batch => batch.id), ...contributors.flatMap(run => run.creditBatchId ? [run.creditBatchId] : [])])];
  const targets = batchIds.sort().map(entityId => ({ entityType: "creditBatch" as const, entityId }));
  // The caller holds the feedstock-type row. Newly discovered failed-source
  // artifacts cannot be waited on behind that row lock.
  const keys = await tryLockCertifiedLineageArtifacts(ctx, tx, targets);
  if (!keys) throw new DomainError("conflict", "Certification inputs changed while saving the feedstock type. Refresh and retry.", { retryable: true });
  await synchronizeFailedEmissionBatches(ctx, tx, contributors.filter(run => run.kind === "failed" && run.creditBatchId).map(run => run.creditBatchId!));
  const lineage = (await Promise.all(targets.map(target => getLineageUnderLockedArtifacts(ctx, tx, keys, target)))).flat();
  const removals = new Set<string>();
  for (const row of lineage.filter(isSubmittedLineageRow)) {
    removals.add(row.removalId);
  }
  return {
    locked: removals.size > 0,
    removals: await withRemovalFacilities(ctx, tx, removals),
  };
}
