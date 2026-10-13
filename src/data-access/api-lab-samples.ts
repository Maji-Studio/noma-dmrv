import { and, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, productionRuns, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { findApiCreditBatch } from "./api-credit-batches";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, requireApiLookupFacility, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiLabSampleFilters {
  q?: string; facilityId?: string; creditBatchId?: string; code?: string; sampledFrom?: string; sampledBefore?: string;
}

/** Explicit columns: the heavy metal, contaminant, file URL and run link columns are never selected. */
function sampleFields(ctx: OrgContext) {
  requireOrgScope(ctx);
  return {
    id: samples.id,
    code: samples.sampleCode,
    version: samples.version,
    creditBatchId: samples.creditBatchId,
    samplingTime: samples.samplingTime,
    labName: samples.labName,
    labAccreditation: samples.labAccreditation,
    analysisDate: samples.analysisDate,
    weightGrams: samples.weightGrams,
    volumeMl: samples.volumeMl,
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
    r0AnalysisDate: samples.r0AnalysisDate,
    reactiveCarbonPercent: samples.reactiveCarbonPercent,
    residualCarbonPercent: samples.residualCarbonPercent,
    tgaAnalysisDate: samples.tgaAnalysisDate,
    phosphorusPercent: samples.phosphorusPercent,
    potassiumPercent: samples.potassiumPercent,
    magnesiumPercent: samples.magnesiumPercent,
    calciumPercent: samples.calciumPercent,
    ironPercent: samples.ironPercent,
    createdAt: samples.createdAt,
    updatedAt: samples.updatedAt,
    cursorCreatedAt: lookupCursorCreatedAt(samples.createdAt),
  };
}

/** A sample on an archived batch stays readable by id or code; only lists hide it. */
export async function findApiLabSample(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await executor.select(sampleFields(ctx)).from(samples).where(and(
    eq(samples.organizationId, ctx.organizationId),
    "id" in identifier ? eq(samples.id, identifier.id) : eq(samples.sampleCode, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Lab sample was not found.", {
    issues: [{ path: ["labSampleId"], code: "not_found", message: "Lab sample was not found." }],
  });
  return row;
}

/**
 * Newest first by (createdAt, id). The facility filter matches through the
 * credit batch, or through the production run on a legacy sample that has
 * none, as the app's list does. Samples on archived batches are hidden.
 */
export async function listApiLabSamples(ctx: OrgContext, filters: ApiLabSampleFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  if (filters.creditBatchId) await findApiCreditBatch(ctx, { id: filters.creditBatchId });
  return db.select(sampleFields(ctx)).from(samples)
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .where(and(
      eq(samples.organizationId, ctx.organizationId), isNull(creditBatches.archivedAt),
      filters.facilityId ? or(eq(creditBatches.facilityId, filters.facilityId), eq(productionRuns.facilityId, filters.facilityId)) : undefined,
      filters.creditBatchId ? eq(samples.creditBatchId, filters.creditBatchId) : undefined,
      filters.code !== undefined ? eq(samples.sampleCode, filters.code) : undefined,
      filters.sampledFrom ? gte(samples.samplingTime, new Date(filters.sampledFrom)) : undefined,
      filters.sampledBefore ? lt(samples.samplingTime, new Date(filters.sampledBefore)) : undefined,
      lookupSearch({ name: samples.sampleCode }, filters.q),
      lookupPosition(samples, cursor),
    )).orderBy(desc(samples.createdAt), desc(samples.id)).limit(limit + 1);
}
