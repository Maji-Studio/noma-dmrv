import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatches, creditBatchProductionRuns, emissionEntries, facilities, feedstocks,
  productionRunFeedstocks, productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { isSentRemoval, readsAsReturnedFromPersisted } from "@/lib/record-lock";
import { removalSplitsApplicationsByBatch } from "@/lib/certification/removal-application-policy";
import { listCreditBatchCertificationLinks } from "./credit-batch-certification-links";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { readRecordLockLineage } from "./record-lock-lineage";
import {
  creditBatchRunFitConditions, filterSingleFeedstockTypeRuns,
  loadProductionRunHoldingAllocations, pickCreditBatchRunHoldingAllocation,
} from "./credit-batch-run-fit";
import { requireOrgScope } from "./utils";

export interface CreditBatchMissingProductionRuns {
  sentRemovalCodes: string[];
  /** Draft or returned holders, only when no holder keeps the batch Sent. */
  heldRemovalCodes: string[];
  /** First day of the batch period; entries must be dated inside it. */
  batchStartDate: string;
  runs: { id: string; code: string; startDate: string; createdAt: Date; heldByRemovalCode: string | null }[];
  /** Undeleted additive values; creation time determines which runs they can report. */
  manualEntries: { occurredOn: string; createdAt: Date }[];
}

/** Read-only, set-based facts for the Check to-dos, independent of template availability. */
export async function loadCreditBatchesMissingProductionRuns(
  ctx: OrgContext,
  creditBatchIds: readonly string[],
): Promise<Map<string, CreditBatchMissingProductionRuns>> {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return new Map();
  const links = await listCreditBatchCertificationLinks(ctx, [...creditBatchIds]);
  const facts = await readRecordLockLineage(ctx, db, links.flatMap(link => link.removalId
    ? [{ removalId: link.removalId, ghgStatementId: link.ghgStatementId }] : []));
  // Display uses persisted return evidence. Writes still require fresh lineage under locks.
  const sentIds = new Set(facts.filter(fact => isSentRemoval(fact) && !readsAsReturnedFromPersisted(fact))
    .map(fact => fact.id));
  const sentByBatch = new Map<string, string[]>();
  const heldByBatch = new Map<string, string[]>();
  for (const link of links.sort((a, b) => (a.removalCode ?? "").localeCompare(b.removalCode ?? "") ||
    (a.removalId ?? "").localeCompare(b.removalId ?? ""))) {
    if (!link.removalId || !link.removalCode) continue;
    const holders = sentIds.has(link.removalId) ? sentByBatch : heldByBatch;
    const codes = holders.get(link.id) ?? [];
    if (!codes.includes(link.removalCode)) codes.push(link.removalCode);
    holders.set(link.id, codes);
  }
  for (const id of sentByBatch.keys()) heldByBatch.delete(id);
  const sentBatchIds = [...sentByBatch.keys()];
  const heldBatchIds = [...heldByBatch.keys()];
  // Unheld batches attach matching runs on completion and expand membership on save.
  const batchIds = [...sentBatchIds, ...heldBatchIds];
  if (!batchIds.length) return new Map();
  const fit = creditBatchRunFitConditions(ctx.organizationId, {
    facilityId: creditBatches.facilityId, startDate: creditBatches.startDate, endDate: creditBatches.endDate,
  });
  const [rows, entries, heldBatches] = await Promise.all([
    db.selectDistinct({
      creditBatchId: creditBatches.id,
      batchStartDate: creditBatches.startDate,
      batchFeedstockTypeId: creditBatches.feedstockTypeId,
      feedstockTypeId: feedstocks.feedstockTypeId,
      productionRunId: productionRuns.id,
      code: productionRuns.code,
      createdAt: productionRuns.createdAt,
      startDate: productionRunDateExpr(ctx.organizationId),
    }).from(creditBatches).innerJoin(productionRuns, fit.productionRun)
      .innerJoin(productionRunFeedstocks, fit.feedstockLink)
      .innerJoin(feedstocks, fit.feedstock)
      .leftJoin(creditBatchProductionRuns, fit.membership).where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      inArray(creditBatches.id, batchIds),
      isNull(creditBatches.archivedAt),
      fit.unassigned,
    )).orderBy(productionRuns.code, productionRuns.id),
    db.selectDistinct({ creditBatchId: emissionEntries.creditBatchId, occurredOn: emissionEntries.occurredOn,
      createdAt: emissionEntries.createdAt })
      .from(emissionEntries).where(and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        inArray(emissionEntries.creditBatchId, batchIds),
        eq(emissionEntries.kind, "value"),
        eq(emissionEntries.lineRule, "additive"),
        isNull(emissionEntries.deletedAt),
      )),
    heldBatchIds.length ? db.select({ creditBatchId: creditBatches.id, durabilityOption: facilities.durabilityOption })
      .from(creditBatches).innerJoin(facilities, and(
        eq(facilities.id, creditBatches.facilityId),
        eq(facilities.organizationId, ctx.organizationId),
      )).where(and(
        eq(creditBatches.organizationId, ctx.organizationId),
        inArray(creditBatches.id, heldBatchIds),
      )) : [],
  ]);
  const result = new Map<string, CreditBatchMissingProductionRuns>(batchIds.map(id => [id, {
    sentRemovalCodes: sentByBatch.get(id) ?? [], heldRemovalCodes: heldByBatch.get(id) ?? [],
    batchStartDate: "", runs: [], manualEntries: [],
  }]));
  for (const row of filterSingleFeedstockTypeRuns(rows, row => row.batchFeedstockTypeId,
    row => `${row.creditBatchId}:${row.productionRunId}`)) {
    result.get(row.creditBatchId)!.batchStartDate = row.batchStartDate;
    result.get(row.creditBatchId)!.runs.push({ id: row.productionRunId, code: row.code, startDate: row.startDate,
      createdAt: row.createdAt, heldByRemovalCode: null });
  }
  const heldRunIds = [...new Set(heldBatches.flatMap(batch => result.get(batch.creditBatchId)!.runs.map(run => run.id)))];
  const allocations = await loadProductionRunHoldingAllocations(ctx, db, heldRunIds);
  for (const batch of heldBatches) {
    const missing = result.get(batch.creditBatchId)!;
    const splits = removalSplitsApplicationsByBatch(batch.durabilityOption);
    for (const run of missing.runs) {
      run.heldByRemovalCode = pickCreditBatchRunHoldingAllocation(allocations, run.id, batch.creditBatchId, splits)?.removalCode ?? null;
    }
  }
  for (const entry of entries) {
    result.get(entry.creditBatchId)!.manualEntries.push({ occurredOn: entry.occurredOn, createdAt: entry.createdAt });
  }
  return result;
}
