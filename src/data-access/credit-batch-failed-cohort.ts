import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatUtcDate } from "@/lib/date-utils";
import { failedRunEmissionBatchCondition } from "./failed-run-emission-predicate";
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
  // Creation and window edits inspect a prospective cohort without a saved row.
  const rows = await tx.select({ productionRunId: productionRuns.id }).from(productionRuns)
    .where(and(eq(productionRuns.organizationId, ctx.organizationId),
      isNull(productionRuns.archivedAt), failedRunEmissionBatchCondition(ctx, undefined, {
        ...cohort,
        startDate: typeof cohort.startDate === "string" ? cohort.startDate : formatUtcDate(cohort.startDate),
        endDate: typeof cohort.endDate === "string" ? cohort.endDate : formatUtcDate(cohort.endDate),
      })));
  return rows.map(row => row.productionRunId).sort();
}
