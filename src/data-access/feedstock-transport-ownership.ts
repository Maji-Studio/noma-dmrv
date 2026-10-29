import { db, type DbTransaction } from "@/db";
import { productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { feedstockTransportOwners } from "@/lib/certification/feedstock-transport-ownership";
import { and, eq, inArray } from "drizzle-orm";
import { requireOrgScope } from "./utils";

/** Resolve across all linked organization runs, never only the requested batch. */
export async function getFeedstockTransportOwners(
  ctx: OrgContext,
  feedstockIds: string[],
  executor: typeof db | DbTransaction = db,
): Promise<Map<string, string>> {
  requireOrgScope(ctx);
  const ids = [...new Set(feedstockIds)];
  if (!ids.length) return new Map();
  const draws = await executor.select({
    feedstockId: productionRunFeedstocks.feedstockId,
    runId: productionRuns.id,
    startTime: productionRuns.startTime,
    status: productionRuns.status,
  }).from(productionRunFeedstocks)
    .innerJoin(productionRuns, and(
      eq(productionRuns.id, productionRunFeedstocks.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      inArray(productionRunFeedstocks.feedstockId, ids),
    ));
  return feedstockTransportOwners(draws);
}
