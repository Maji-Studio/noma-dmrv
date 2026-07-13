import { and, asc, eq, inArray } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { productionProcesses } from "@/db/schema/production-processes";
import { productionRuns, samples } from "@/db/schema/production";
import type { Sample } from "@/db/schema";
import {
  deriveBatchSamplingMethod,
  type SamplingMethod,
} from "@/lib/certification/sampling-requirements";
import type { CreditBatchDurabilityInput } from "@/lib/isometric/utils/durability-aggregation";
import { DURABILITY_TIER_FALLBACK } from "@/schemas/credit-batches";
import { requireOrgScope } from "./utils";

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
  /** The batch's effective sampling method at its immutable start boundary. */
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
  ctx: OrgContext,
  creditBatchIds: string[],
): Promise<CreditBatchWithSamples[]> {
  requireOrgScope(ctx);
  const ids = Array.from(new Set(creditBatchIds));
  if (ids.length === 0) return [];

  const batchRows = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      startDate: creditBatches.startDate,
      productionProcessId: creditBatches.productionProcessId,
      declaredHToCorgRatio: creditBatches.hToCorgRatio,
      // Tier is inherited from the facility (ADR 0021), not a batch column.
      durabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(inArray(creditBatches.id, ids), eq(creditBatches.organizationId, ctx.organizationId)));
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
            methodBUnlockedAt: productionProcesses.methodBUnlockedAt,
          })
          .from(productionProcesses)
          .where(and(inArray(productionProcesses.id, processIds), eq(productionProcesses.organizationId, ctx.organizationId)))
      : [];
  const samplingRegimeByProcess = new Map<
    string,
    { samplingMethod: SamplingMethod; methodBUnlockedAt: Date | null }
  >(
    processRows.map((p) => [
      p.id,
      {
        samplingMethod: p.samplingMethod as SamplingMethod,
        methodBUnlockedAt: p.methodBUnlockedAt,
      },
    ]),
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
      and(eq(creditBatchProductionRuns.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)),
    )
    .where(and(
      inArray(creditBatchProductionRuns.creditBatchId, ids),
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
    ));

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
  // visible to the durability surfaces again. Ordered by id: Postgres gives no
  // row order without one, and the 1000-year submission body (and thus its
  // change-detection hash) carries per-replicate values in this order — an
  // unordered read could flip the hash for unchanged rows.
  const sampleRows = await db
    .select()
    .from(samples)
    .where(and(inArray(samples.creditBatchId, ids), eq(samples.organizationId, ctx.organizationId)))
    .orderBy(asc(samples.id));
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
    samplingMethod: (() => {
      if (batch.productionProcessId == null) return "method_a";
      const regime = samplingRegimeByProcess.get(batch.productionProcessId);
      if (regime == null) return "method_a";
      return deriveBatchSamplingMethod({
        processMethod: regime.samplingMethod,
        methodBUnlockedAt: regime.methodBUnlockedAt,
        batchStartDate: batch.startDate,
      });
    })(),
    declaredHToCorgRatio: batch.declaredHToCorgRatio,
    durabilityOption: batch.durabilityOption ?? DURABILITY_TIER_FALLBACK,
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
  ctx: OrgContext,
  creditBatchIds: string[],
): Promise<CreditBatchSampleRef[]> {
  requireOrgScope(ctx);
  const ids = Array.from(new Set(creditBatchIds));
  if (ids.length === 0) return [];

  const rows = await db
    .select({ id: samples.id, creditBatchId: samples.creditBatchId })
    .from(samples)
    .where(and(inArray(samples.creditBatchId, ids), eq(samples.organizationId, ctx.organizationId)));

  return rows.flatMap((row) =>
    row.creditBatchId == null
      ? []
      : [{ id: row.id, creditBatchId: row.creditBatchId }],
  );
}
