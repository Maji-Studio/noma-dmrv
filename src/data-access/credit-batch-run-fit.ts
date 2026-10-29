import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, type AnyColumn } from "drizzle-orm";
import { applicationOutputAllocations, certifierRemovals, creditBatchApplications, creditBatchProductionRuns, feedstocks, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { productionRunMembershipDateExpr } from "./production-runs/date-expr";
import { requireOrgScope, type Executor } from "./utils";

/** Allocations that prevent Add run, preferring this batch's held slice. */
export async function loadCreditBatchRunHoldingAllocations(
  ctx: OrgContext,
  executor: Executor,
  productionRunIds: readonly string[],
  creditBatchId: string,
  splitsApplicationsByBatch: boolean,
) {
  requireOrgScope(ctx);
  if (!productionRunIds.length) return [];
  return queryProductionRunHoldingAllocations(ctx, executor, productionRunIds,
    splitsApplicationsByBatch ? creditBatchId : undefined)
    .orderBy(desc(eq(creditBatchApplications.creditBatchId, creditBatchId)));
}

/** All held Application slices for a set of runs, independent of the target batch. */
export async function loadProductionRunHoldingAllocations(
  ctx: OrgContext,
  executor: Executor,
  productionRunIds: readonly string[],
) {
  requireOrgScope(ctx);
  if (!productionRunIds.length) return [];
  return queryProductionRunHoldingAllocations(ctx, executor, productionRunIds);
}

export function pickCreditBatchRunHoldingAllocation(
  allocations: readonly Awaited<ReturnType<typeof loadProductionRunHoldingAllocations>>[number][],
  productionRunId: string,
  creditBatchId: string,
  splitsApplicationsByBatch: boolean,
) {
  const own = allocations.find(row => row.productionRunId === productionRunId && row.creditBatchId === creditBatchId);
  return own ?? (splitsApplicationsByBatch ? undefined : allocations.find(row => row.productionRunId === productionRunId));
}

function queryProductionRunHoldingAllocations(
  ctx: OrgContext,
  executor: Executor,
  productionRunIds: readonly string[],
  creditBatchId?: string,
) {
  requireOrgScope(ctx);
  return executor.select({
    productionRunId: applicationOutputAllocations.productionRunId,
    removalId: certifierRemovals.id,
    removalCode: certifierRemovals.code,
    creditBatchId: creditBatchApplications.creditBatchId,
  }).from(applicationOutputAllocations)
    .innerJoin(creditBatchApplications, and(
      eq(creditBatchApplications.applicationId, applicationOutputAllocations.applicationId),
      eq(creditBatchApplications.organizationId, ctx.organizationId),
    ))
    .innerJoin(certifierRemovals, and(
      eq(certifierRemovals.id, creditBatchApplications.removalId),
      eq(certifierRemovals.organizationId, ctx.organizationId),
    ))
    .where(and(
      inArray(applicationOutputAllocations.productionRunId, [...productionRunIds]),
      eq(applicationOutputAllocations.organizationId, ctx.organizationId),
      isNotNull(creditBatchApplications.removalId),
      creditBatchId !== undefined ? eq(creditBatchApplications.creditBatchId, creditBatchId) : undefined,
    ));
}

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
