import { and, eq, gte, isNull, lte } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { feedstocks, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatUtcDate } from "@/lib/date-utils";
import { filterSingleFeedstockTypeRuns } from "./credit-batch-run-fit";
import { productionRunMembershipDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

export type FailedEmissionCohort = {
  facilityId: string;
  feedstockTypeId: string;
  startDate: string | Date;
  endDate: string | Date;
};

/** Prospective emissions only. These IDs must never be persisted as material members. */
export async function findFailedEmissionCohortRunIds(
  ctx: OrgContext,
  tx: DbTransaction,
  cohort: FailedEmissionCohort,
): Promise<string[]> {
  requireOrgScope(ctx);
  const endDay = productionRunMembershipDateExpr(ctx.organizationId);
  const rows = await tx.selectDistinct({
    productionRunId: productionRuns.id,
    feedstockTypeId: feedstocks.feedstockTypeId,
  }).from(productionRuns)
    .innerJoin(productionRunFeedstocks, and(
      eq(productionRunFeedstocks.productionRunId, productionRuns.id),
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
    ))
    .innerJoin(feedstocks, and(eq(feedstocks.id, productionRunFeedstocks.feedstockId),
      eq(feedstocks.organizationId, ctx.organizationId)))
    .where(and(eq(productionRuns.organizationId, ctx.organizationId),
      eq(productionRuns.facilityId, cohort.facilityId), eq(productionRuns.status, "failed"),
      isNull(productionRuns.archivedAt), gte(endDay, typeof cohort.startDate === "string" ? cohort.startDate : formatUtcDate(cohort.startDate)),
      lte(endDay, typeof cohort.endDate === "string" ? cohort.endDate : formatUtcDate(cohort.endDate))));
  return filterSingleFeedstockTypeRuns(rows, () => cohort.feedstockTypeId)
    .map(row => row.productionRunId).sort();
}
