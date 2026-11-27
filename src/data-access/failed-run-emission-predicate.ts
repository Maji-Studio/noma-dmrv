import { FAILED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { creditBatches, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { productionRunMembershipDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

/**
 * Certification dependency only, never material membership. Both tables must be
 * in the caller's query unless checking a prospective, not-yet-saved cohort. Archive-inclusive discovery retains every historical
 * target, including ambiguous overlapping batches, instead of choosing one.
 */
export function failedRunEmissionBatchCondition(
  ctx: OrgContext, endDay?: SQL,
  prospective?: { facilityId: string; feedstockTypeId: string; startDate: string; endDate: string },
): SQL {
  requireOrgScope(ctx);
  const day = endDay ?? productionRunMembershipDateExpr(ctx.organizationId);
  const batch = prospective ?? creditBatches;
  return and(
    eq(productionRuns.organizationId, ctx.organizationId),
    prospective ? undefined : eq(creditBatches.organizationId, ctx.organizationId),
    eq(productionRuns.status, FAILED_PRODUCTION_RUN_STATUS),
    eq(productionRuns.facilityId, batch.facilityId),
    gte(day, batch.startDate), lte(day, batch.endDate),
    // A scalar aggregate resolves repeated same-type draws but rejects both
    // empty and mixed provenance. Keep aliases local to avoid outer joins.
    sql`(select case when count(distinct emission_stock.feedstock_type_id) = 1
      then min(emission_stock.feedstock_type_id::text) end
      from production_run_feedstocks emission_draw
      inner join feedstocks emission_stock on emission_stock.id = emission_draw.feedstock_id
        and emission_stock.organization_id = ${ctx.organizationId}
      where emission_draw.organization_id = ${ctx.organizationId}
        and emission_draw.production_run_id = ${productionRuns.id}
    ) = ${batch.feedstockTypeId}::text`,
  )!;
}
