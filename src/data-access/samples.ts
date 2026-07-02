/**
 * Samples Data Access Layer
 * CRUD operations for lab samples with auth guards, pagination, and filtering
 * A Sample anchors on ONE credit batch (the protocol production batch) per
 * Isometric Protocol Section 8.3 / issue #309; the production-run column is
 * legacy provenance only (pre-re-grain rows) and is no longer written.
 */

import { and, asc, avg, count, desc, eq, gte, ilike, lte, or, sql, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  creditBatches,
  samples,
  productionRuns,
  facilities,
} from "@/db/schema";
import type { SampleFilterData } from "@/schemas/samples";
import { deleteTransportLegsForEntity } from "./transport-legs";

// ============================================
// Types
// ============================================

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
  volatileMatterPercent: number | null;

  // Physical
  bulkDensityKgPerM3: number | null;
  ph: number | null;
  surfaceAreaM2PerG: number | null;
  saltContentGPerKg: number | null;

  // Stability
  hToCOrgRatio: number | null;
  oToCOrgRatio: number | null;
  durabilityOption: "200_year" | "1000_year";

  // 1000-year durability
  randomReflectanceR0Percent: number | null;
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

  // Relations
  creditBatchCode: string | null;
  facilityCode: string | null;
  facilityName: string | null;
}

export interface PaginatedSamples {
  items: SampleWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SampleStats {
  totalSamples: number;
  avgCarbonPercent: number | null;
  avgOrganicCarbonPercent: number | null;
  samples200Year: number;
  samples1000Year: number;
}

// ============================================
// Auth Guards
// ============================================

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";

const runFacilities = alias(facilities, "sample_run_facilities");
const batchFacilities = alias(facilities, "sample_batch_facilities");

// ============================================
// Sample Read Operations
// ============================================

/**
 * Get all samples with pagination and filtering
 * Supports search, credit batch filter, durability option, date range, sorting, and pagination
 */
export async function getSamples(
  userId: string,
  filters?: Partial<SampleFilterData>
): Promise<PaginatedSamples> {
  requireAuth(userId);

  const {
    search,
    creditBatchId,
    facilityId,
    // durabilityOption not yet supported in DB filtering
    startDate,
    endDate,
    page = 1,
    pageSize = 20,
    sortBy = "samplingTime",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(samples.sampleCode, searchPattern));
  }

  if (creditBatchId) {
    conditions.push(eq(samples.creditBatchId, creditBatchId));
  }

  if (facilityId) {
    conditions.push(
      or(
        eq(productionRuns.facilityId, facilityId),
        eq(creditBatches.facilityId, facilityId),
      )!,
    );
  }

  // Note: durabilityOption is not in the DB schema, we'd need to add it or infer
  // For now, we'll skip this filter or check for 1000-year fields presence

  if (startDate) {
    conditions.push(gte(samples.samplingTime, startDate));
  }

  if (endDate) {
    conditions.push(lte(samples.samplingTime, endDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    sampleCode: samples.sampleCode,
    samplingTime: samples.samplingTime,
    totalCarbonPercent: samples.totalCarbonPercent,
    createdAt: samples.createdAt,
    updatedAt: samples.updatedAt,
  }[sortBy] ?? samples.samplingTime;

  const orderFn = sortOrder === "asc" ? asc : desc;

  // Count total for pagination
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(samples)
    .leftJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
    .leftJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get samples with relations
  const sampleList = await db
    .select({
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
      creditBatchCode: creditBatches.code,
      batchDurabilityOption: creditBatches.durabilityOption,
      facilityCode: sql<string | null>`coalesce(${batchFacilities.code}, ${runFacilities.code})`,
      facilityName: sql<string | null>`coalesce(${batchFacilities.name}, ${runFacilities.name})`,
    })
    .from(samples)
    .leftJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
    .leftJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .leftJoin(runFacilities, eq(productionRuns.facilityId, runFacilities.id))
    .leftJoin(batchFacilities, eq(creditBatches.facilityId, batchFacilities.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Map results with computed fields
  const items: SampleWithRelations[] = sampleList.map(
    ({ batchDurabilityOption, ...sample }) => ({
      ...sample,
      volatileMatterPercent: null, // Not in current DB schema
      surfaceAreaM2PerG: null, // Not in current DB schema
      // The durability tier lives on the credit batch (issue #309); infer from
      // R₀ presence only for legacy batchless rows.
      durabilityOption:
        batchDurabilityOption ??
        (sample.randomReflectanceR0Percent != null
          ? ("1000_year" as const)
          : ("200_year" as const)),
      nutrientClaimEnabled: !!(
        sample.phosphorusPercent ||
        sample.potassiumPercent ||
        sample.magnesiumPercent ||
        sample.calciumPercent ||
        sample.ironPercent
      ),
    }),
  );

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single sample by ID
 * Returns sample data with all relations
 */
export async function getSampleById(
  userId: string,
  sampleId: string
): Promise<SampleWithRelations> {
  requireAuth(userId);

  const [sample] = await db
    .select({
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
      creditBatchCode: creditBatches.code,
      batchDurabilityOption: creditBatches.durabilityOption,
      facilityCode: sql<string | null>`coalesce(${batchFacilities.code}, ${runFacilities.code})`,
      facilityName: sql<string | null>`coalesce(${batchFacilities.name}, ${runFacilities.name})`,
    })
    .from(samples)
    .leftJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
    .leftJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .leftJoin(runFacilities, eq(productionRuns.facilityId, runFacilities.id))
    .leftJoin(batchFacilities, eq(creditBatches.facilityId, batchFacilities.id))
    .where(eq(samples.id, sampleId));

  if (!sample) {
    throw new SafeError("Sample not found");
  }

  const { batchDurabilityOption, ...rest } = sample;
  return {
    ...rest,
    volatileMatterPercent: null,
    surfaceAreaM2PerG: null,
    durabilityOption:
      batchDurabilityOption ??
      (rest.randomReflectanceR0Percent != null ? "1000_year" : "200_year"),
    nutrientClaimEnabled: !!(
      rest.phosphorusPercent ||
      rest.potassiumPercent ||
      rest.magnesiumPercent ||
      rest.calciumPercent ||
      rest.ironPercent
    ),
  };
}

/**
 * Get sample statistics
 * Returns aggregated stats for dashboard display
 */
export async function getSampleStats(
  userId: string,
  creditBatchId?: string,
  facilityId?: string,
): Promise<SampleStats> {
  requireAuth(userId);

  const conditions: SQL[] = [];
  if (creditBatchId) {
    conditions.push(eq(samples.creditBatchId, creditBatchId));
  }
  if (facilityId) {
    conditions.push(
      or(
        eq(productionRuns.facilityId, facilityId),
        eq(creditBatches.facilityId, facilityId),
      )!,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalSamples: count(),
      avgCarbonPercent: avg(samples.totalCarbonPercent),
      avgOrganicCarbonPercent: avg(samples.organicCarbonPercent),
    })
    .from(samples)
    .leftJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
    .leftJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .where(whereClause);

  // Count 1000-year samples — the tier is the credit batch's declared choice
  // (issue #309); legacy batchless rows fall back to R₀-reflectance presence.
  const is1000Year = sql`(
    ${creditBatches.durabilityOption} = '1000_year'
    or (${creditBatches.id} is null and ${samples.randomReflectanceR0Percent} is not null)
  )`;
  const [samples1000Year] = await db
    .select({ count: count() })
    .from(samples)
    .leftJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
    .leftJoin(creditBatches, eq(samples.creditBatchId, creditBatches.id))
    .where(whereClause ? and(whereClause, is1000Year) : is1000Year);

  const total = Number(stats.totalSamples);
  const samples1000 = Number(samples1000Year.count);

  return {
    totalSamples: total,
    avgCarbonPercent: stats.avgCarbonPercent ? Number(stats.avgCarbonPercent) : null,
    avgOrganicCarbonPercent: stats.avgOrganicCarbonPercent
      ? Number(stats.avgOrganicCarbonPercent)
      : null,
    samples200Year: total - samples1000,
    samples1000Year: samples1000,
  };
}

// ============================================
// Sample Create Operations
// ============================================

/**
 * Create a new sample
 */
export async function createSample(
  userId: string,
  data: {
    sampleCode: string;
    // The credit batch (protocol production batch) this replicate
    // characterises — required (issue #309): every sample belongs to exactly
    // one batch, and the batch's biochar is commingled across its runs so no
    // production run is attributable.
    creditBatchId: string;
    samplingTime: Date;
    labName?: string | null;
    labAccreditation?: string | null;
    analysisDate?: Date | null;
    weightGrams?: number | null;
    volumeMl?: number | null;
    totalCarbonPercent: number;
    organicCarbonPercent: number;
    inorganicCarbonPercent?: number | null;
    totalHydrogenPercent?: number | null;
    totalNitrogenPercent?: number | null;
    totalOxygenPercent?: number | null;
    totalSulfurPercent?: number | null;
    ashContentPercent?: number | null;
    moistureContentPercent?: number | null;
    bulkDensityKgPerM3?: number | null;
    ph?: number | null;
    saltContentGPerKg?: number | null;
    hToCOrgRatio?: number | null;
    oToCOrgRatio?: number | null;
    randomReflectanceR0Percent?: number | null;
    r0MeasurementCount?: number | null;
    r0AnalysisDate?: Date | null;
    r0HistogramFileUrl?: string | null;
    reactiveCarbonPercent?: number | null;
    residualCarbonPercent?: number | null;
    tgaAnalysisDate?: Date | null;
    tgaThermogramFileUrl?: string | null;
    phosphorusPercent?: number | null;
    potassiumPercent?: number | null;
    magnesiumPercent?: number | null;
    calciumPercent?: number | null;
    ironPercent?: number | null;
  }
): Promise<SampleWithRelations> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: samples.id })
    .from(samples)
    .where(eq(samples.sampleCode, data.sampleCode));

  if (existing) {
    throw new SafeError("A sample with this code already exists");
  }

  // Verify the credit batch exists
  const [creditBatch] = await db
    .select({ id: creditBatches.id })
    .from(creditBatches)
    .where(eq(creditBatches.id, data.creditBatchId));

  if (!creditBatch) {
    throw new SafeError("Credit batch not found");
  }

  // Create sample
  const sample = await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "creditBatch", entityId: data.creditBatchId },
      "create",
    );

    const [created] = await tx
      .insert(samples)
      .values({
        sampleCode: data.sampleCode,
        creditBatchId: data.creditBatchId,
        samplingTime: data.samplingTime,
        labName: data.labName ?? null,
        labAccreditation: data.labAccreditation ?? null,
        analysisDate: data.analysisDate
          ? data.analysisDate.toISOString().split("T")[0]
          : null,
        weightGrams: data.weightGrams ?? null,
        volumeMl: data.volumeMl ?? null,
        totalCarbonPercent: data.totalCarbonPercent,
        organicCarbonPercent: data.organicCarbonPercent,
        inorganicCarbonPercent: data.inorganicCarbonPercent ?? null,
        totalHydrogenPercent: data.totalHydrogenPercent ?? null,
        totalNitrogenPercent: data.totalNitrogenPercent ?? null,
        totalOxygenPercent: data.totalOxygenPercent ?? null,
        totalSulfurPercent: data.totalSulfurPercent ?? null,
        ashContentPercent: data.ashContentPercent ?? null,
        moistureContentPercent: data.moistureContentPercent ?? null,
        bulkDensityKgPerM3: data.bulkDensityKgPerM3 ?? null,
        ph: data.ph ?? null,
        saltContentGPerKg: data.saltContentGPerKg ?? null,
        hToCOrgRatio: data.hToCOrgRatio ?? null,
        oToCOrgRatio: data.oToCOrgRatio ?? null,
        randomReflectanceR0Percent: data.randomReflectanceR0Percent ?? null,
        r0MeasurementCount: data.r0MeasurementCount ?? null,
        r0AnalysisDate: data.r0AnalysisDate
          ? data.r0AnalysisDate.toISOString().split("T")[0]
          : null,
        r0HistogramFileUrl: data.r0HistogramFileUrl ?? null,
        reactiveCarbonPercent: data.reactiveCarbonPercent ?? null,
        residualCarbonPercent: data.residualCarbonPercent ?? null,
        tgaAnalysisDate: data.tgaAnalysisDate
          ? data.tgaAnalysisDate.toISOString().split("T")[0]
          : null,
        tgaThermogramFileUrl: data.tgaThermogramFileUrl ?? null,
        phosphorusPercent: data.phosphorusPercent ?? null,
        potassiumPercent: data.potassiumPercent ?? null,
        magnesiumPercent: data.magnesiumPercent ?? null,
        calciumPercent: data.calciumPercent ?? null,
        ironPercent: data.ironPercent ?? null,
      })
      .returning();
    return created;
  });

  return getSampleById(userId, sample.id);
}

// ============================================
// Sample Update Operations
// ============================================

/**
 * Update an existing sample
 */
export async function updateSample(
  userId: string,
  sampleId: string,
  data: {
    sampleCode?: string;
    creditBatchId?: string;
    samplingTime?: Date;
    labName?: string | null;
    labAccreditation?: string | null;
    analysisDate?: Date | null;
    weightGrams?: number | null;
    volumeMl?: number | null;
    totalCarbonPercent?: number;
    organicCarbonPercent?: number;
    inorganicCarbonPercent?: number | null;
    totalHydrogenPercent?: number | null;
    totalNitrogenPercent?: number | null;
    totalOxygenPercent?: number | null;
    totalSulfurPercent?: number | null;
    ashContentPercent?: number | null;
    moistureContentPercent?: number | null;
    bulkDensityKgPerM3?: number | null;
    ph?: number | null;
    saltContentGPerKg?: number | null;
    hToCOrgRatio?: number | null;
    oToCOrgRatio?: number | null;
    randomReflectanceR0Percent?: number | null;
    r0MeasurementCount?: number | null;
    r0AnalysisDate?: Date | null;
    r0HistogramFileUrl?: string | null;
    reactiveCarbonPercent?: number | null;
    residualCarbonPercent?: number | null;
    tgaAnalysisDate?: Date | null;
    tgaThermogramFileUrl?: string | null;
    phosphorusPercent?: number | null;
    potassiumPercent?: number | null;
    magnesiumPercent?: number | null;
    calciumPercent?: number | null;
    ironPercent?: number | null;
  }
): Promise<SampleWithRelations> {
  requireAuth(userId);

  // Verify sample exists
  const [existing] = await db
    .select()
    .from(samples)
    .where(eq(samples.id, sampleId));

  if (!existing) {
    throw new SafeError("Sample not found");
  }

  // If code is being changed, check for duplicates
  if (data.sampleCode && data.sampleCode !== existing.sampleCode) {
    const [duplicate] = await db
      .select({ id: samples.id })
      .from(samples)
      .where(eq(samples.sampleCode, data.sampleCode));

    if (duplicate) {
      throw new SafeError("A sample with this code already exists");
    }
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.sampleCode !== undefined) updateData.sampleCode = data.sampleCode;
  if (data.creditBatchId !== undefined) updateData.creditBatchId = data.creditBatchId;
  if (data.samplingTime !== undefined) updateData.samplingTime = data.samplingTime;
  if (data.labName !== undefined) updateData.labName = data.labName;
  if (data.labAccreditation !== undefined) updateData.labAccreditation = data.labAccreditation;
  if (data.analysisDate !== undefined) {
    updateData.analysisDate = data.analysisDate
      ? data.analysisDate.toISOString().split("T")[0]
      : null;
  }
  if (data.weightGrams !== undefined) updateData.weightGrams = data.weightGrams;
  if (data.volumeMl !== undefined) updateData.volumeMl = data.volumeMl;
  if (data.totalCarbonPercent !== undefined) updateData.totalCarbonPercent = data.totalCarbonPercent;
  if (data.organicCarbonPercent !== undefined) updateData.organicCarbonPercent = data.organicCarbonPercent;
  if (data.inorganicCarbonPercent !== undefined) updateData.inorganicCarbonPercent = data.inorganicCarbonPercent;
  if (data.totalHydrogenPercent !== undefined) updateData.totalHydrogenPercent = data.totalHydrogenPercent;
  if (data.totalNitrogenPercent !== undefined) updateData.totalNitrogenPercent = data.totalNitrogenPercent;
  if (data.totalOxygenPercent !== undefined) updateData.totalOxygenPercent = data.totalOxygenPercent;
  if (data.totalSulfurPercent !== undefined) updateData.totalSulfurPercent = data.totalSulfurPercent;
  if (data.ashContentPercent !== undefined) updateData.ashContentPercent = data.ashContentPercent;
  if (data.moistureContentPercent !== undefined) updateData.moistureContentPercent = data.moistureContentPercent;
  if (data.bulkDensityKgPerM3 !== undefined) updateData.bulkDensityKgPerM3 = data.bulkDensityKgPerM3;
  if (data.ph !== undefined) updateData.ph = data.ph;
  if (data.saltContentGPerKg !== undefined) updateData.saltContentGPerKg = data.saltContentGPerKg;
  if (data.hToCOrgRatio !== undefined) updateData.hToCOrgRatio = data.hToCOrgRatio;
  if (data.oToCOrgRatio !== undefined) updateData.oToCOrgRatio = data.oToCOrgRatio;
  if (data.randomReflectanceR0Percent !== undefined) updateData.randomReflectanceR0Percent = data.randomReflectanceR0Percent;
  if (data.r0MeasurementCount !== undefined) updateData.r0MeasurementCount = data.r0MeasurementCount;
  if (data.r0AnalysisDate !== undefined) {
    updateData.r0AnalysisDate = data.r0AnalysisDate
      ? data.r0AnalysisDate.toISOString().split("T")[0]
      : null;
  }
  if (data.r0HistogramFileUrl !== undefined) updateData.r0HistogramFileUrl = data.r0HistogramFileUrl;
  if (data.reactiveCarbonPercent !== undefined) updateData.reactiveCarbonPercent = data.reactiveCarbonPercent;
  if (data.residualCarbonPercent !== undefined) updateData.residualCarbonPercent = data.residualCarbonPercent;
  if (data.tgaAnalysisDate !== undefined) {
    updateData.tgaAnalysisDate = data.tgaAnalysisDate
      ? data.tgaAnalysisDate.toISOString().split("T")[0]
      : null;
  }
  if (data.tgaThermogramFileUrl !== undefined) updateData.tgaThermogramFileUrl = data.tgaThermogramFileUrl;
  if (data.phosphorusPercent !== undefined) updateData.phosphorusPercent = data.phosphorusPercent;
  if (data.potassiumPercent !== undefined) updateData.potassiumPercent = data.potassiumPercent;
  if (data.magnesiumPercent !== undefined) updateData.magnesiumPercent = data.magnesiumPercent;
  if (data.calciumPercent !== undefined) updateData.calciumPercent = data.calciumPercent;
  if (data.ironPercent !== undefined) updateData.ironPercent = data.ironPercent;

  await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "sample", entityId: sampleId },
      "update",
    );

    // Moving a sample onto a batch that's already part of a submitted artifact
    // would silently change certified chemistry — guard the TARGET batch too.
    if (
      data.creditBatchId !== undefined &&
      data.creditBatchId !== existing.creditBatchId
    ) {
      await assertCanMutateCertifiedLineage(
        tx,
        { entityType: "creditBatch", entityId: data.creditBatchId },
        "update",
      );
    }

    await tx.update(samples).set(updateData).where(eq(samples.id, sampleId));
  });

  return getSampleById(userId, sampleId);
}

// ============================================
// Sample Delete Operations
// ============================================

/**
 * Delete a sample
 */
export async function deleteSample(
  userId: string,
  sampleId: string
): Promise<void> {
  requireAuth(userId);

  // Verify sample exists
  const [existing] = await db
    .select({ id: samples.id })
    .from(samples)
    .where(eq(samples.id, sampleId));

  if (!existing) {
    throw new SafeError("Sample not found");
  }

  await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "sample", entityId: sampleId },
      "delete",
    );

    await deleteTransportLegsForEntity(tx, "sample", sampleId);
    await tx.delete(samples).where(eq(samples.id, sampleId));
  });
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a sample code is available
 */
export async function isSampleCodeAvailable(
  userId: string,
  code: string,
  excludeSampleId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(samples.sampleCode, code)];

  if (excludeSampleId) {
    conditions.push(sql`${samples.id} != ${excludeSampleId}`);
  }

  const [existing] = await db
    .select({ id: samples.id })
    .from(samples)
    .where(and(...conditions));

  return !existing;
}

/**
 * Generate next sample code
 * Returns the next available code in format S-YYYY-XXX
 */
export async function generateNextSampleCode(userId: string): Promise<string> {
  requireAuth(userId);

  const year = new Date().getFullYear();
  const prefix = `S-${year}-`;

  const [lastSample] = await db
    .select({ sampleCode: samples.sampleCode })
    .from(samples)
    .where(ilike(samples.sampleCode, `${prefix}%`))
    .orderBy(desc(samples.sampleCode))
    .limit(1);

  let nextNumber = 1;
  if (lastSample) {
    const match = lastSample.sampleCode.match(/S-\d{4}-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${nextNumber.toString().padStart(3, "0")}`;
}

/**
 * Get sample options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getSampleOptions(
  userId: string,
  creditBatchId?: string
): Promise<Array<{ id: string; sampleCode: string; samplingTime: Date }>> {
  requireAuth(userId);

  const conditions: SQL[] = [];
  if (creditBatchId) {
    conditions.push(eq(samples.creditBatchId, creditBatchId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      id: samples.id,
      sampleCode: samples.sampleCode,
      samplingTime: samples.samplingTime,
    })
    .from(samples)
    .where(whereClause)
    .orderBy(desc(samples.samplingTime));
}
