import { db, type DbTransaction } from "@/db";
import { creditBatchProductionRuns, creditBatches, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CountedOnBatch } from "@/lib/certification/emission-lines";
import { feedstockTransportOwners } from "@/lib/certification/feedstock-transport-ownership";
import { loadRunEmissionContributors } from "./credit-batch-emission-contributors";
import { and, eq, inArray, isNull, isNotNull, or } from "drizzle-orm";
import { requireOrgScope } from "./utils";

async function loadEligibleDraws(
  ctx: OrgContext,
  ids: string[],
  executor: Pick<DbTransaction, "select" | "selectDistinct">,
  options: { includeArchived?: boolean } = {},
) {
  requireOrgScope(ctx);
  const draws = await executor.select({
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
      inArray(productionRuns.status, ["complete", "failed"]),
      options.includeArchived ? undefined : isNull(productionRuns.archivedAt),
    ))
    .leftJoin(creditBatchProductionRuns, and(
      eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    ))
    .leftJoin(creditBatches, and(
      eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
      eq(creditBatches.organizationId, ctx.organizationId),
      options.includeArchived ? undefined : isNull(creditBatches.archivedAt),
    ))
    .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      or(eq(productionRuns.status, "failed"), isNotNull(creditBatches.id)),
      inArray(productionRunFeedstocks.feedstockId, ids)));
  const failedIds = [...new Set(draws.filter(draw => draw.status === "failed").map(draw => draw.runId))];
  const contributors = failedIds.length
    ? await loadRunEmissionContributors(ctx, failedIds, executor, options) : [];
  const byRun = new Map(contributors.map(run => [run.runId, run]));
  return draws.flatMap(draw => {
    if (draw.status === "complete" && draw.creditBatchId && draw.creditBatchCode)
      return [{ ...draw, failedEmissionAttached: false, creditBatchId: draw.creditBatchId, creditBatchCode: draw.creditBatchCode }];
    const contributor = byRun.get(draw.runId);
    return contributor?.creditBatchId ? [{ ...draw,
      failedEmissionAttached: contributor.kind === "failed",
      creditBatchId: contributor.creditBatchId, creditBatchCode: contributor.creditBatchCode!,
    }] : [];
  });
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
