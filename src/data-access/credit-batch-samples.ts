import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
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
  /** The batch's declared durability tier — its samples inherit it (issue #309). */
  durabilityOption: "200_year" | "1000_year";
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
      // Tier is inherited from the facility (ADR 0021), not a batch column.
      durabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
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
    durabilityOption: batch.durabilityOption ?? "200_year",
    runs: runsByBatch.get(batch.id) ?? [],
    samples: samplesByBatch.get(batch.id) ?? [],
  }));
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
