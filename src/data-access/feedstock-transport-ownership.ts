import { db, type DbTransaction } from "@/db";
import { creditBatchProductionRuns, creditBatches, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { feedstockTransportOwners } from "@/lib/certification/feedstock-transport-ownership";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireOrgScope } from "./utils";

async function loadEligibleDraws(ctx: OrgContext, ids: string[], executor: Pick<DbTransaction, "select">) {
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
      isNull(productionRuns.archivedAt),
    ))
    .innerJoin(creditBatchProductionRuns, and(
      eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    ))
    .innerJoin(creditBatches, and(
      eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
      eq(creditBatches.organizationId, ctx.organizationId),
      isNull(creditBatches.archivedAt),
    ))
    .where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      inArray(productionRunFeedstocks.feedstockId, ids),
    ));
}

/** Resolve across eligible batched organization runs, never only the requested batch. */
export async function getFeedstockTransportOwners(
  ctx: OrgContext,
  feedstockIds: string[],
  executor: Pick<DbTransaction, "select"> = db,
): Promise<Map<string, string>> {
  requireOrgScope(ctx);
  const ids = [...new Set(feedstockIds)];
  if (!ids.length) return new Map();
  return feedstockTransportOwners(await loadEligibleDraws(ctx, ids, executor));
}

export interface FeedstockTransportOwnerBatch { creditBatchId: string; code: string }

/** The credit batches that count each feedstock record's transport, via the owning run. */
export async function getFeedstockTransportOwnerBatches(
  ctx: OrgContext,
  feedstockIds: string[],
  executor: Pick<DbTransaction, "select"> = db,
): Promise<Map<string, FeedstockTransportOwnerBatch[]>> {
  requireOrgScope(ctx);
  const ids = [...new Set(feedstockIds)];
  if (!ids.length) return new Map();
  const draws = await loadEligibleDraws(ctx, ids, executor);
  const owners = feedstockTransportOwners(draws);
  const result = new Map<string, FeedstockTransportOwnerBatch[]>();
  for (const [feedstockId, runId] of owners) {
    const batches = new Map<string, FeedstockTransportOwnerBatch>();
    for (const draw of draws) {
      if (draw.feedstockId === feedstockId && draw.runId === runId)
        batches.set(draw.creditBatchId, { creditBatchId: draw.creditBatchId, code: draw.creditBatchCode });
    }
    result.set(feedstockId, [...batches.values()]);
  }
  return result;
}
