import { touchedRunFeedstock } from './touched-run-feedstock';
import { getRecordLocks } from './certification-lineage-guards';
import { db, type DbTransaction } from "@/db";
import { creditBatchProductionRuns, creditBatches, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CountedOnBatch } from "@/lib/certification/emission-lines";
import { feedstockTransportOwners } from "@/lib/certification/feedstock-transport-ownership";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { and, eq, inArray, isNull, or, lte } from "drizzle-orm";
import { requireOrgScope } from "./utils";

async function loadEligibleDraws(
  ctx: OrgContext,
  ids: string[],
  executor: Pick<DbTransaction, "select" | "selectDistinct">,
  options: { includeArchived?: boolean } = {},
) {
  requireOrgScope(ctx);
  const legacy = await executor.selectDistinct({ feedstockId: productionRunFeedstocks.feedstockId })
    .from(productionRunFeedstocks).where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      inArray(productionRunFeedstocks.feedstockId, ids), lte(productionRunFeedstocks.wetMassUsedKg, 0),
    ));
  const linked = legacy.length ? await executor.selectDistinct({ feedstockId: productionRunFeedstocks.feedstockId, runId: productionRunFeedstocks.productionRunId })
    .from(productionRunFeedstocks).where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId), inArray(productionRunFeedstocks.feedstockId, legacy.map(row => row.feedstockId)),
    )) : [];
  const locks = await getRecordLocks(ctx, executor, linked.map(row => ({ entityType: 'productionRun', entityId: row.runId })), { sentOnly: true });
  const sentFeedstockIds = [...new Set(linked.filter((_, index) => locks[index].level === 'sent').map(row => row.feedstockId))];
  // Old ownership counted every row. Keep that candidate set for Sent deliveries,
  // including an earlier unsent zero owner: dropping it could charge a later Sent run.
  return executor.select({
    feedstockId: productionRunFeedstocks.feedstockId,
    runId: productionRuns.id,
    creditBatchId: creditBatches.id,
    creditBatchCode: creditBatches.code,
    startTime: productionRuns.startTime,
    status: productionRuns.status,
  }).from(productionRunFeedstocks)
    .innerJoin(productionRuns, and(
      eq(productionRuns.id, productionRunFeedstocks.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
      eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
      options.includeArchived ? undefined : isNull(productionRuns.archivedAt),
    ))
    .innerJoin(creditBatchProductionRuns, and(
      eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    ))
    .innerJoin(creditBatches, and(
      eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
      eq(creditBatches.organizationId, ctx.organizationId),
      options.includeArchived ? undefined : isNull(creditBatches.archivedAt),
    ))
    .where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      inArray(productionRunFeedstocks.feedstockId, ids),
      or(touchedRunFeedstock(), sentFeedstockIds.length ? inArray(productionRunFeedstocks.feedstockId, sentFeedstockIds) : undefined),
    ));
}

/** Resolve across eligible batched organization runs, never only the requested batch. */
export async function getFeedstockTransportOwners(
  ctx: OrgContext,
  feedstockIds: string[],
  executor: Pick<DbTransaction, "select" | "selectDistinct"> = db,
  options: { includeArchived?: boolean } = {},
): Promise<Map<string, string>> {
  requireOrgScope(ctx);
  const ids = [...new Set(feedstockIds)];
  if (!ids.length) return new Map();
  return feedstockTransportOwners(await loadEligibleDraws(ctx, ids, executor, options));
}

/** The credit batches that count each feedstock record's transport, via the owning run. */
export async function getFeedstockTransportOwnerBatches(
  ctx: OrgContext,
  feedstockIds: string[],
  executor: Pick<DbTransaction, "select" | "selectDistinct"> = db,
  options: { includeArchived?: boolean } = {},
): Promise<Map<string, CountedOnBatch[]>> {
  requireOrgScope(ctx);
  const ids = [...new Set(feedstockIds)];
  if (!ids.length) return new Map();
  const draws = await loadEligibleDraws(ctx, ids, executor, options);
  const owners = feedstockTransportOwners(draws);
  const result = new Map<string, CountedOnBatch[]>();
  for (const [feedstockId, runId] of owners) {
    const batches = new Map<string, CountedOnBatch>();
    for (const draw of draws) {
      if (draw.feedstockId === feedstockId && draw.runId === runId)
        batches.set(draw.creditBatchId, { creditBatchId: draw.creditBatchId, code: draw.creditBatchCode });
    }
    result.set(feedstockId, [...batches.values()]);
  }
  return result;
}
