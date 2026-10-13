/**
 * The Sample read shape the UI and the writers share, and the single-row read.
 * Writers read the row back through their own transaction (issue #769), so
 * `getSampleById` takes an executor.
 */

import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { creditBatches, facilities, productionRuns, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CreditBatchSampling } from "@/schemas/credit-batches";
import { sampleNotFound } from "@/lib/sample-domain-errors";
import { requireOrgScope, type Executor } from "../utils";

export interface SampleWithRelations {
  id: string;
  sampleCode: string;
  // Legacy provenance — pre-re-grain rows only; never written for new samples
  // (issue #309: the batch's runs are commingled, so no run is attributable).
  productionRunId: string | null;
  // The credit batch (protocol production batch) this replicate characterises.
  // Required for new samples; nullable in the type for legacy rows.
  creditBatchId: string | null;
  samplingTime: Date;
  weightGrams: number | null;
  volumeMl: number | null;

  // Lab info
  labName: string | null;
  labAccreditation: string | null;
  analysisDate: string | null;

  // Carbon
  totalCarbonPercent: number;
  organicCarbonPercent: number;
  inorganicCarbonPercent: number | null;

  // Elemental
  totalHydrogenPercent: number | null;
  totalNitrogenPercent: number | null;
  totalOxygenPercent: number | null;
  totalSulfurPercent: number | null;

  // Proximate
  ashContentPercent: number | null;
  moistureContentPercent: number | null;

  // Physical
  bulkDensityKgPerM3: number | null;
  ph: number | null;
  saltContentGPerKg: number | null;

  // Stability
  hToCOrgRatio: number | null;
  oToCOrgRatio: number | null;
  durabilityOption: "200_year" | "1000_year";
  sampling: CreditBatchSampling | null;

  // 1000-year durability
  randomReflectanceR0Percent: number | null;
  sReflectanceFraction: number | null;
  r0MeasurementCount: number | null;
  r0AnalysisDate: string | null;
  r0HistogramFileUrl: string | null;
  reactiveCarbonPercent: number | null;
  residualCarbonPercent: number | null;
  tgaAnalysisDate: string | null;
  tgaThermogramFileUrl: string | null;

  // Nutrients
  nutrientClaimEnabled: boolean;
  phosphorusPercent: number | null;
  potassiumPercent: number | null;
  magnesiumPercent: number | null;
  calciumPercent: number | null;
  ironPercent: number | null;

  createdAt: Date;
  updatedAt: Date;
  version: number;

  // Relations
  creditBatchCode: string | null;
  facilityCode: string | null;
  facilityName: string | null;
  /** The batch facility's zone (legacy rows: the run's), for showing samplingTime on its clock. */
  facilityTimezone: string | null;
}

export const sampleRunFacilities = alias(facilities, "sample_run_facilities");
export const sampleBatchFacilities = alias(facilities, "sample_batch_facilities");

/** The columns of `SampleWithRelations`, before `toSampleWithRelations` derives the tier and nutrient flag. */
export const sampleWithRelationsColumns = {
  id: samples.id,
  sampleCode: samples.sampleCode,
  productionRunId: samples.productionRunId,
  creditBatchId: samples.creditBatchId,
  samplingTime: samples.samplingTime,
  weightGrams: samples.weightGrams,
  volumeMl: samples.volumeMl,
  labName: samples.labName,
  labAccreditation: samples.labAccreditation,
  analysisDate: samples.analysisDate,
  totalCarbonPercent: samples.totalCarbonPercent,
  organicCarbonPercent: samples.organicCarbonPercent,
  inorganicCarbonPercent: samples.inorganicCarbonPercent,
  totalHydrogenPercent: samples.totalHydrogenPercent,
  totalNitrogenPercent: samples.totalNitrogenPercent,
  totalOxygenPercent: samples.totalOxygenPercent,
  totalSulfurPercent: samples.totalSulfurPercent,
  ashContentPercent: samples.ashContentPercent,
  moistureContentPercent: samples.moistureContentPercent,
  bulkDensityKgPerM3: samples.bulkDensityKgPerM3,
  ph: samples.ph,
  saltContentGPerKg: samples.saltContentGPerKg,
  hToCOrgRatio: samples.hToCOrgRatio,
  oToCOrgRatio: samples.oToCOrgRatio,
  randomReflectanceR0Percent: samples.randomReflectanceR0Percent,
  sReflectanceFraction: samples.sReflectanceFraction,
  r0MeasurementCount: samples.r0MeasurementCount,
  reactiveCarbonPercent: samples.reactiveCarbonPercent,
  residualCarbonPercent: samples.residualCarbonPercent,
  r0AnalysisDate: samples.r0AnalysisDate,
  r0HistogramFileUrl: samples.r0HistogramFileUrl,
  tgaAnalysisDate: samples.tgaAnalysisDate,
  tgaThermogramFileUrl: samples.tgaThermogramFileUrl,
  phosphorusPercent: samples.phosphorusPercent,
  potassiumPercent: samples.potassiumPercent,
  magnesiumPercent: samples.magnesiumPercent,
  calciumPercent: samples.calciumPercent,
  ironPercent: samples.ironPercent,
  createdAt: samples.createdAt,
  updatedAt: samples.updatedAt,
  version: samples.version,
  creditBatchCode: creditBatches.code,
  sampling: creditBatches.sampling,
  batchDurabilityOption: sampleBatchFacilities.durabilityOption,
  facilityCode: sql<string | null>`coalesce(${sampleBatchFacilities.code}, ${sampleRunFacilities.code})`,
  facilityName: sql<string | null>`coalesce(${sampleBatchFacilities.name}, ${sampleRunFacilities.name})`,
  facilityTimezone: sql<string | null>`coalesce(${sampleBatchFacilities.timezone}, ${sampleRunFacilities.timezone})`,
};

type SampleRow = Omit<SampleWithRelations, "durabilityOption" | "nutrientClaimEnabled"> & {
  batchDurabilityOption: "200_year" | "1000_year" | null;
};

export function toSampleWithRelations({ batchDurabilityOption, ...sample }: SampleRow): SampleWithRelations {
  return {
    ...sample,
    // The durability tier lives on the credit batch's facility (issue #309);
    // infer from R₀ presence only for legacy batchless rows.
    durabilityOption: batchDurabilityOption ?? (sample.randomReflectanceR0Percent != null ? "1000_year" : "200_year"),
    nutrientClaimEnabled: !!(
      sample.phosphorusPercent ||
      sample.potassiumPercent ||
      sample.magnesiumPercent ||
      sample.calciumPercent ||
      sample.ironPercent
    ),
  };
}

/**
 * Get a single sample by ID
 * Returns sample data with all relations
 */
export async function getSampleById(
  ctx: OrgContext,
  sampleId: string,
  executor: Executor = db,
): Promise<SampleWithRelations> {
  requireOrgScope(ctx);

  const [sample] = await executor
    .select(sampleWithRelationsColumns)
    .from(samples)
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .leftJoin(sampleRunFacilities, and(eq(productionRuns.facilityId, sampleRunFacilities.id), eq(sampleRunFacilities.organizationId, ctx.organizationId)))
    .leftJoin(sampleBatchFacilities, and(eq(creditBatches.facilityId, sampleBatchFacilities.id), eq(sampleBatchFacilities.organizationId, ctx.organizationId)))
    .where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)));

  if (!sample) throw sampleNotFound();
  return toSampleWithRelations(sample);
}
