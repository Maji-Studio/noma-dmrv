import { eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { productionProcesses } from "@/db/schema/production-processes";
import { productionRuns, samples } from "@/db/schema/production";
import type { Sample } from "@/db/schema";
import type { SamplingMethod } from "@/lib/certification/sampling-requirements";
import type { CreditBatchDurabilityInput } from "@/lib/isometric/utils/durability-aggregation";
import { requireAuth } from "./utils";

/**
 * A credit batch's durability inputs as loaded from the DB: its lab Samples
 * pooled on `samples.creditBatchId` (across member runs/days — ADR 0016 made the
 * credit batch the sampling unit and the run link nullable provenance), its
 * member production runs, and the sampling method + declared H/C_org carried for
 * the gate and reconciliation. Structurally a superset of
 * `CreditBatchDurabilityInput`, so it feeds `buildPerBatchDurabilityData`
 * directly.
 */
export interface CreditBatchWithSamples extends CreditBatchDurabilityInput {
  runs: Array<{ id: string; code: string; biocharDryMassKg: number | null }>;
  /** The (facility, feedstock) process this batch belongs to; null = unfound. */
  productionProcessId: string | null;
  /** The batch's process's CURRENT sampling method (default Method A). */
  samplingMethod: SamplingMethod;
  /** Operator-declared `credit_batches.h_to_c_org_ratio` (advisory; reconciled). */
  declaredHToCorgRatio: number | null;
}

/**
 * Load each credit batch's durability inputs keyed on the CREDIT BATCH grain:
 * lab Samples by `samples.creditBatchId` (NOT via `production_runs` — that read
 * skips any commingled-batch sample with a null run link), the member runs via
 * `credit_batch_production_runs`, and the sampling method off the batch's
 * production process. The spine of the re-grained durability data plane
 * (ADR 0016 Phase 1 of this plan). Batches absent from the DB are omitted.
 */
export async function getCreditBatchesWithSamples(
  userId: string,
  creditBatchIds: string[],
): Promise<CreditBatchWithSamples[]> {
  requireAuth(userId);
  const ids = Array.from(new Set(creditBatchIds));
  if (ids.length === 0) return [];

  const batchRows = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      productionProcessId: creditBatches.productionProcessId,
      declaredHToCorgRatio: creditBatches.hToCorgRatio,
    })
    .from(creditBatches)
    .where(inArray(creditBatches.id, ids));
  if (batchRows.length === 0) return [];

  const processIds = Array.from(
    new Set(
      batchRows
        .map((b) => b.productionProcessId)
        .filter((id): id is string => id != null),
    ),
  );
  const processRows =
    processIds.length > 0
      ? await db
          .select({
            id: productionProcesses.id,
            samplingMethod: productionProcesses.samplingMethod,
          })
          .from(productionProcesses)
          .where(inArray(productionProcesses.id, processIds))
      : [];
  const samplingMethodByProcess = new Map<string, SamplingMethod>(
    processRows.map((p) => [p.id, p.samplingMethod as SamplingMethod]),
  );

  // Member runs per batch (id + code + dry mass) via the join table.
  const runJoinRows = await db
    .select({
      creditBatchId: creditBatchProductionRuns.creditBatchId,
      runId: productionRuns.id,
      runCode: productionRuns.code,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
    })
    .from(creditBatchProductionRuns)
    .innerJoin(
      productionRuns,
      eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
    )
    .where(inArray(creditBatchProductionRuns.creditBatchId, ids));

  const runsByBatch = new Map<
    string,
    Array<{ id: string; code: string; biocharDryMassKg: number | null }>
  >();
  for (const row of runJoinRows) {
    const list = runsByBatch.get(row.creditBatchId) ?? [];
    list.push({
      id: row.runId,
      code: row.runCode,
      biocharDryMassKg: row.biocharDryMassKg,
    });
    runsByBatch.set(row.creditBatchId, list);
  }

  // Samples pooled by credit batch — the key re-grain. Skips the null-run filter
  // `getProductionRunsWithSamples` applies, so commingled-batch chemistry is
  // visible to the durability surfaces again.
  const sampleRows = await db
    .select()
    .from(samples)
    .where(inArray(samples.creditBatchId, ids));
  const samplesByBatch = new Map<string, Sample[]>();
  for (const s of sampleRows) {
    if (s.creditBatchId == null) continue;
    const list = samplesByBatch.get(s.creditBatchId) ?? [];
    list.push(s);
    samplesByBatch.set(s.creditBatchId, list);
  }

  return batchRows.map((batch) => ({
    creditBatchId: batch.id,
    creditBatchCode: batch.code,
    productionProcessId: batch.productionProcessId,
    samplingMethod: batch.productionProcessId
      ? samplingMethodByProcess.get(batch.productionProcessId) ?? "method_a"
      : "method_a",
    declaredHToCorgRatio: batch.declaredHToCorgRatio,
    runs: runsByBatch.get(batch.id) ?? [],
    samples: samplesByBatch.get(batch.id) ?? [],
  }));
}

/** The credit batch a production run is committed to. */
export interface RunCreditBatchRef {
  creditBatchId: string;
  creditBatchCode: string;
}

/**
 * Resolve the credit batch a production run belongs to (via
 * `credit_batch_production_runs`). The join's per-run unique constraint means a
 * run is committed to AT MOST ONE batch, so this returns a single ref or null
 * (an uncommitted run). Powers the lab-sample form's derived-batch preview —
 * from the run the operator anchors a sample to, surface the credit batch the
 * sample characterises and its sampling progress (ADR 0016).
 */
export async function getCreditBatchIdForRun(
  userId: string,
  productionRunId: string,
): Promise<RunCreditBatchRef | null> {
  requireAuth(userId);
  if (!productionRunId) return null;

  const [row] = await db
    .select({
      creditBatchId: creditBatches.id,
      creditBatchCode: creditBatches.code,
    })
    .from(creditBatchProductionRuns)
    .innerJoin(
      creditBatches,
      eq(creditBatchProductionRuns.creditBatchId, creditBatches.id),
    )
    .where(eq(creditBatchProductionRuns.productionRunId, productionRunId))
    .limit(1);

  return row ?? null;
}

/**
 * Resolve the credit batch id a production run is committed to, within a given
 * executor (an open transaction or the base db). Reads only the membership join
 * — the per-run unique constraint guarantees ≤1. Used by the sample write path to
 * DERIVE `samples.creditBatchId` from the run so ADR 0016's "both links stay
 * populated" invariant holds for form-created samples (the form never sets the
 * batch directly). Returns null for an uncommitted run.
 */
export async function resolveRunCreditBatchId(
  executor: DbTransaction | typeof db,
  productionRunId: string | null | undefined,
): Promise<string | null> {
  if (!productionRunId) return null;
  const [row] = await executor
    .select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
    .from(creditBatchProductionRuns)
    .where(eq(creditBatchProductionRuns.productionRunId, productionRunId))
    .limit(1);
  return row?.creditBatchId ?? null;
}

/** A lab Sample id paired with the credit batch it characterises. */
export interface CreditBatchSampleRef {
  id: string;
  creditBatchId: string;
}

/**
 * Resolve the lab Sample ids that roll up to each credit batch, keyed on
 * `samples.creditBatchId` (the COA-evidence walk, ADR 0016). Used by the Source
 * candidate collection in place of the run→samples read, which skips any
 * commingled-batch sample with a null run link. Returns one entry per sample.
 */
export async function getSamplesByCreditBatchIds(
  userId: string,
  creditBatchIds: string[],
): Promise<CreditBatchSampleRef[]> {
  requireAuth(userId);
  const ids = Array.from(new Set(creditBatchIds));
  if (ids.length === 0) return [];

  const rows = await db
    .select({ id: samples.id, creditBatchId: samples.creditBatchId })
    .from(samples)
    .where(inArray(samples.creditBatchId, ids));

  return rows.flatMap((row) =>
    row.creditBatchId == null
      ? []
      : [{ id: row.id, creditBatchId: row.creditBatchId }],
  );
}
