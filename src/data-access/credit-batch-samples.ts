import { and, asc, eq, inArray } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { productionRuns, samples } from "@/db/schema/production";
import type { Sample } from "@/db/schema";
import type { CreditBatchDurabilityInput } from "@/lib/isometric/utils/durability-aggregation";
import type { CreditBatchSampling } from "@/schemas/credit-batches";
import { requireOrgScope } from "./utils";
import { getBatchesWithLabReports } from "./sample-document-evidence";

/**
 * A credit batch's durability inputs as loaded from the DB: its lab Samples
 * pooled on `samples.creditBatchId` (across member runs/days — ADR 0016 made the
 * credit batch the sampling unit and the run link nullable provenance), its
 * member production runs, and the sampling choice. Structurally a superset of
 * `CreditBatchDurabilityInput`, so it feeds `buildPerBatchDurabilityData`
 * directly.
 */
export interface CreditBatchWithSamples extends CreditBatchDurabilityInput {
  hasLabReport?: boolean;
  /** ISO date-only production window bounds from the credit-batch row. */
  startDate?: string | null;
  endDate?: string | null;
  /** IANA timezone used to classify sampling instants by facility-local day. */
  facilityTimezone: string;
  runs: Array<{ id: string; code: string; biocharDryMassKg: number | null }>;
  /** Immutable sampled/unsampled choice stored on this batch (ADR 0022). */
  sampling: CreditBatchSampling;
  /** The batch's declared durability tier — its samples inherit it (issue #309). */
  durabilityOption: "200_year" | "1000_year";
}

/**
 * Load each credit batch's durability inputs keyed on the CREDIT BATCH grain:
 * lab Samples by `samples.creditBatchId` (NOT via `production_runs` — that read
 * skips any commingled-batch sample with a null run link), the member runs via
 * `credit_batch_production_runs`, and the immutable sampling choice on the
 * batch. The spine of the re-grained durability data plane
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
      endDate: creditBatches.endDate,
      sampling: creditBatches.sampling,
      // Tier is inherited from the facility (ADR 0021), not a batch column.
      durabilityOption: facilities.durabilityOption,
      facilityTimezone: facilities.timezone,
    })
    .from(creditBatches)
    .innerJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(inArray(creditBatches.id, ids), eq(creditBatches.organizationId, ctx.organizationId)));
  if (batchRows.length === 0) return [];

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

  // Samples pooled by credit batch, including commingled biochar. Ordered by id:
  // Postgres gives no row order without one, and the 1000-year submission body (and thus its
  // change-detection hash) carries per-replicate values in this order — an
  // unordered read could flip the hash for unchanged rows.
  const sampleRows = await db
    .select()
    .from(samples)
    .where(and(inArray(samples.creditBatchId, ids), eq(samples.organizationId, ctx.organizationId)))
    .orderBy(asc(samples.id));
  const samplesByBatch = new Map<string, Sample[]>();
  for (const s of sampleRows) {
    const list = samplesByBatch.get(s.creditBatchId) ?? [];
    list.push(s);
    samplesByBatch.set(s.creditBatchId, list);
  }

  const batchesWithReports = await getBatchesWithLabReports(ctx, ids, db, sampleRows);
  return batchRows.map((batch) => ({
    hasLabReport: batchesWithReports.has(batch.id),
    creditBatchId: batch.id,
    creditBatchCode: batch.code,
    startDate: batch.startDate,
    endDate: batch.endDate,
    facilityTimezone: batch.facilityTimezone,
    sampling: batch.sampling,
    durabilityOption: batch.durabilityOption,
    runs: runsByBatch.get(batch.id) ?? [],
    samples: samplesByBatch.get(batch.id) ?? [],
  }));
}

/** A lab Sample id paired with the credit batch it characterises. */
export interface CreditBatchSampleRef {
  id: string;
  creditBatchId: string;
  sampleCode: string;
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
    .select({
      id: samples.id,
      creditBatchId: samples.creditBatchId,
      sampleCode: samples.sampleCode,
    })
    .from(samples)
    .where(and(inArray(samples.creditBatchId, ids), eq(samples.organizationId, ctx.organizationId)));

  return rows;
}
