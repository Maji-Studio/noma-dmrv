import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatches, creditBatchProductionRuns, emissionEntries, feedstocks,
  productionRunFeedstocks, productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { readCreditBatchesMembershipSubmissionLocks } from "./credit-batch-certification-lock";
import { productionRunDateExpr, productionRunMembershipDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

export interface CreditBatchLateProductionRuns {
  sentRemovalCodes: string[];
  /** First day of the batch period; entries must be dated inside it. */
  batchStartDate: string;
  runs: { id: string; code: string; startDate: string; createdAt: Date }[];
  /** Undeleted additive values; creation time determines which runs they can report. */
  manualEntries: { occurredOn: string; createdAt: Date }[];
}

/** Read-only, set-based facts for the Check to-dos, independent of template availability. */
export async function loadCreditBatchesLateProductionRuns(
  ctx: OrgContext,
  creditBatchIds: readonly string[],
): Promise<Map<string, CreditBatchLateProductionRuns>> {
  requireOrgScope(ctx);
  const sentByBatch = await readCreditBatchesMembershipSubmissionLocks(ctx, db, creditBatchIds);
  const sentBatchIds = [...sentByBatch.keys()];
  if (!sentBatchIds.length) return new Map();
  const [rows, entries] = await Promise.all([
    db.selectDistinct({
      creditBatchId: creditBatches.id,
      batchStartDate: creditBatches.startDate,
      batchFeedstockTypeId: creditBatches.feedstockTypeId,
      feedstockTypeId: feedstocks.feedstockTypeId,
      id: productionRuns.id,
      code: productionRuns.code,
      createdAt: productionRuns.createdAt,
      startDate: productionRunDateExpr(ctx.organizationId),
    }).from(creditBatches).innerJoin(productionRuns, and(
      eq(productionRuns.organizationId, ctx.organizationId),
      eq(productionRuns.facilityId, creditBatches.facilityId),
      eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
      isNull(productionRuns.archivedAt),
      gte(productionRunMembershipDateExpr(ctx.organizationId), creditBatches.startDate),
      lte(productionRunMembershipDateExpr(ctx.organizationId), creditBatches.endDate),
    )).innerJoin(productionRunFeedstocks, and(
      eq(productionRunFeedstocks.productionRunId, productionRuns.id),
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
    )).innerJoin(feedstocks, and(
      eq(feedstocks.id, productionRunFeedstocks.feedstockId),
      eq(feedstocks.organizationId, ctx.organizationId),
    )).leftJoin(creditBatchProductionRuns, and(
      eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    )).where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      inArray(creditBatches.id, sentBatchIds),
      isNull(creditBatches.archivedAt),
      isNull(creditBatchProductionRuns.creditBatchId),
    )).orderBy(productionRuns.code, productionRuns.id),
    db.selectDistinct({ creditBatchId: emissionEntries.creditBatchId, occurredOn: emissionEntries.occurredOn,
      createdAt: emissionEntries.createdAt })
      .from(emissionEntries).where(and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        inArray(emissionEntries.creditBatchId, sentBatchIds),
        eq(emissionEntries.kind, "value"),
        eq(emissionEntries.lineRule, "additive"),
        isNull(emissionEntries.deletedAt),
      )),
  ]);
  const result = new Map<string, CreditBatchLateProductionRuns>(sentBatchIds.map(id => [id, {
    sentRemovalCodes: sentByBatch.get(id)!, batchStartDate: "", runs: [], manualEntries: [],
  }]));
  // Match attachment's single-feedstock rule: mixed and empty runs cannot join a cohort.
  const candidates = new Map<string, { row: typeof rows[number]; types: Set<string> }>();
  for (const row of rows) {
    const key = `${row.creditBatchId}:${row.id}`;
    const candidate = candidates.get(key) ?? { row, types: new Set<string>() };
    candidate.types.add(row.feedstockTypeId);
    candidates.set(key, candidate);
  }
  for (const { row, types } of candidates.values()) {
    if (types.size !== 1 || !types.has(row.batchFeedstockTypeId)) continue;
    result.get(row.creditBatchId)!.batchStartDate = row.batchStartDate;
    result.get(row.creditBatchId)!.runs.push({ id: row.id, code: row.code, startDate: row.startDate, createdAt: row.createdAt });
  }
  for (const entry of entries) {
    result.get(entry.creditBatchId)!.manualEntries.push({ occurredOn: entry.occurredOn, createdAt: entry.createdAt });
  }
  return result;
}
