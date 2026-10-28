import { and, eq, gte, isNull, lte, type AnyColumn } from "drizzle-orm";
import { creditBatchProductionRuns, feedstocks, productionRunFeedstocks, productionRuns } from "@/db/schema";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { productionRunMembershipDateExpr } from "./production-runs/date-expr";

/** Shared fit predicates for one cohort or a set-based join against stored batches. */
export function creditBatchRunFitConditions(organizationId: string, window: {
  facilityId: string | AnyColumn;
  startDate: string | AnyColumn;
  endDate: string | AnyColumn;
}) {
  return {
    productionRun: and(
      eq(productionRuns.organizationId, organizationId),
      eq(productionRuns.facilityId, window.facilityId),
      eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
      isNull(productionRuns.archivedAt),
      gte(productionRunMembershipDateExpr(organizationId), window.startDate),
      lte(productionRunMembershipDateExpr(organizationId), window.endDate),
    ),
    feedstockLink: and(
      eq(productionRunFeedstocks.productionRunId, productionRuns.id),
      eq(productionRunFeedstocks.organizationId, organizationId),
    ),
    feedstock: and(
      eq(feedstocks.id, productionRunFeedstocks.feedstockId),
      eq(feedstocks.organizationId, organizationId),
    ),
    membership: and(
      eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
      eq(creditBatchProductionRuns.organizationId, organizationId),
    ),
    unassigned: isNull(creditBatchProductionRuns.creditBatchId),
  };
}

/** Keep one row per fitting run; mixed and empty feedstock types cannot join a cohort. */
export function filterSingleFeedstockTypeRuns<Row extends { productionRunId: string; feedstockTypeId: string }>(
  rows: readonly Row[],
  feedstockTypeId: (row: Row) => string,
  key: (row: Row) => string = row => row.productionRunId,
): Row[] {
  const candidates = new Map<string, { row: Row; types: Set<string> }>();
  for (const row of rows) {
    const candidateKey = key(row);
    const candidate = candidates.get(candidateKey) ?? { row, types: new Set<string>() };
    candidate.types.add(row.feedstockTypeId);
    candidates.set(candidateKey, candidate);
  }
  return [...candidates.values()]
    .filter(({ row, types }) => types.size === 1 && types.has(feedstockTypeId(row)))
    .map(({ row }) => row);
}
