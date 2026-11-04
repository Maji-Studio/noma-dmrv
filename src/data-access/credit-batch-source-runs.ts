/**
 * A record's credit batches follow the production runs behind its biochar
 * (#1059 section 2): the batches whose run membership includes a source run.
 * The saved feedstock line and every unsaved form's preview resolve runs to
 * batches here, so a preview names what the saved record will show.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatchProductionRuns, creditBatches, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordCreditBatch } from "@/types/record-credit-batches";
import { requireOrgScope } from "./utils";

type Reader = Pick<DbTransaction, "select">;

export interface SourceRunCreditBatches {
  /** Distinct batches, by window start then code. */
  batches: RecordCreditBatch[];
  /** The given runs that belong to at least one of them. */
  batchedRunIds: Set<string>;
}

/** The org's credit batches that hold any of these production runs. */
export async function getCreditBatchesForSourceRuns(
  ctx: OrgContext,
  runIds: readonly string[],
  reader: Reader = db,
): Promise<SourceRunCreditBatches> {
  requireOrgScope(ctx);
  if (!runIds.length) return { batches: [], batchedRunIds: new Set() };
  const rows = await reader.select({
    runId: creditBatchProductionRuns.productionRunId,
    id: creditBatches.id,
    code: creditBatches.code,
    startDate: creditBatches.startDate,
    endDate: creditBatches.endDate,
  }).from(creditBatchProductionRuns)
    .innerJoin(productionRuns, and(
      eq(productionRuns.id, creditBatchProductionRuns.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    )).innerJoin(creditBatches, and(
      eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
      eq(creditBatches.organizationId, ctx.organizationId),
    )).where(and(
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      inArray(creditBatchProductionRuns.productionRunId, [...new Set(runIds)]),
    )).orderBy(creditBatches.startDate, creditBatches.code);
  const batches = new Map<string, RecordCreditBatch>();
  for (const row of rows) {
    if (!batches.has(row.id)) batches.set(row.id, { id: row.id, code: row.code, startDate: row.startDate, endDate: row.endDate });
  }
  return { batches: [...batches.values()], batchedRunIds: new Set(rows.map(row => row.runId)) };
}
