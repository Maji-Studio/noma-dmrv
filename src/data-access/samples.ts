/**
 * Samples Data Access Layer
 * CRUD operations for lab samples with auth guards, pagination, and filtering
 * A Sample anchors on ONE credit batch (the protocol production batch) per
 * Isometric Protocol Section 8.3 / issue #309; the production-run column is
 * legacy provenance only (pre-re-grain rows) and is no longer written.
 */

import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbTransaction } from "@/db";
import { avgNumeric } from "@/db/aggregate";
import {
  creditBatches,
  samples,
  productionRuns,
  facilities,
} from "@/db/schema";
import type { SampleFilterData } from "@/schemas/samples";
import type { CreditBatchSampling } from "@/schemas/credit-batches";
import { deleteTransportLegsForEntity } from "./transport-legs";
import { retireDocumentsForEntities } from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import type { OrgContext } from "@/lib/auth/server";

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

import { assertSameOrg, requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import {
  isPgCheckViolationMessage,
  isPgUniqueViolation,
} from "@/db/errors";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { assertCarbonReconciliation } from "./samples/carbon-reconciliation";

// DB-enforced sample-code uniqueness (issue #395). Drizzle names the
// `.unique()` on `samples.sampleCode` this constraint.
const SAMPLE_CODE_UNIQUE_CONSTRAINT = "samples_organization_id_sample_code_unique";
const METHOD_B_BASELINE_VIOLATION_FRAGMENT =
  "cannot use Method B: requires >= 30 prior Method A samples";
const METHOD_B_BASELINE_FLOOR_MESSAGE =
  "This change would reduce the Method-B baseline below 30 qualifying Method-A Samples. Keep at least 30 qualifying Method-A Samples recorded before Method B was enabled.";

/**
 * Run a sample update/delete and translate invariant-specific Postgres errors
 * into operator-facing SafeErrors. Create routes code uniqueness through
 * `withAutoCode`; the Method-B trigger can reject updates and deletes.
 */
async function guardSampleMutation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPgUniqueViolation(err, SAMPLE_CODE_UNIQUE_CONSTRAINT)) {
      throw new SafeError("A Sample with this code already exists.");
    }
    if (isPgCheckViolationMessage(err, METHOD_B_BASELINE_VIOLATION_FRAGMENT)) {
      throw new SafeError(METHOD_B_BASELINE_FLOOR_MESSAGE);
    }
    throw err;
  }
}

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
  ctx: OrgContext,
  filters?: Partial<SampleFilterData>
): Promise<PaginatedSamples> {
  requireOrgScope(ctx);

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
  const conditions: SQL[] = [eq(samples.organizationId, ctx.organizationId)];

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
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
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
      creditBatchCode: creditBatches.code,
      sampling: creditBatches.sampling,
      batchDurabilityOption: batchFacilities.durabilityOption,
      facilityCode: sql<string | null>`coalesce(${batchFacilities.code}, ${runFacilities.code})`,
      facilityName: sql<string | null>`coalesce(${batchFacilities.name}, ${runFacilities.name})`,
    })
    .from(samples)
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .leftJoin(runFacilities, and(eq(productionRuns.facilityId, runFacilities.id), eq(runFacilities.organizationId, ctx.organizationId)))
    .leftJoin(batchFacilities, and(eq(creditBatches.facilityId, batchFacilities.id), eq(batchFacilities.organizationId, ctx.organizationId)))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Map results with computed fields
  const items: SampleWithRelations[] = sampleList.map(
    ({ batchDurabilityOption, ...sample }) => ({
      ...sample,
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
  ctx: OrgContext,
  sampleId: string
): Promise<SampleWithRelations> {
  requireOrgScope(ctx);

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
      creditBatchCode: creditBatches.code,
      sampling: creditBatches.sampling,
      batchDurabilityOption: batchFacilities.durabilityOption,
      facilityCode: sql<string | null>`coalesce(${batchFacilities.code}, ${runFacilities.code})`,
      facilityName: sql<string | null>`coalesce(${batchFacilities.name}, ${runFacilities.name})`,
    })
    .from(samples)
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .leftJoin(runFacilities, and(eq(productionRuns.facilityId, runFacilities.id), eq(runFacilities.organizationId, ctx.organizationId)))
    .leftJoin(batchFacilities, and(eq(creditBatches.facilityId, batchFacilities.id), eq(batchFacilities.organizationId, ctx.organizationId)))
    .where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)));

  if (!sample) {
    throw new SafeError("Sample not found");
  }

  const { batchDurabilityOption, ...rest } = sample;
  return {
    ...rest,
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
  ctx: OrgContext,
  creditBatchId?: string,
  facilityId?: string,
): Promise<SampleStats> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(samples.organizationId, ctx.organizationId)];
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
      avgCarbonPercent: avgNumeric(samples.totalCarbonPercent),
      avgOrganicCarbonPercent: avgNumeric(samples.organicCarbonPercent),
    })
    .from(samples)
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .where(whereClause);

  // Count 1000-year samples — the tier is inherited from the batch's facility
  // (ADR 0021); legacy batchless rows fall back to R₀-reflectance presence.
  const is1000Year = sql`(
    ${batchFacilities.durabilityOption} = '1000_year'
    or (${creditBatches.id} is null and ${samples.randomReflectanceR0Percent} is not null)
  )`;
  const [samples1000Year] = await db
    .select({ count: count() })
    .from(samples)
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .leftJoin(batchFacilities, and(eq(creditBatches.facilityId, batchFacilities.id), eq(batchFacilities.organizationId, ctx.organizationId)))
    .where(whereClause ? and(whereClause, is1000Year) : is1000Year);

  const total = Number(stats.totalSamples);
  const samples1000 = Number(samples1000Year.count);

  return {
    totalSamples: total,
    avgCarbonPercent: stats.avgCarbonPercent,
    avgOrganicCarbonPercent: stats.avgOrganicCarbonPercent,
    samples200Year: total - samples1000,
    samples1000Year: samples1000,
  };
}

// ============================================
// Sample Create Operations
// ============================================

// The credit batch's declared tier — NOT the client-synced `durabilityOption`
// mirror kept in form state — is the source of truth for the 1000-year
// evidence invariant (issue #309): a stale form, a failed batch-summary query,
// or a direct server-action call could otherwise persist a 1000-year sample
// missing its mandatory R₀/TGA fields (PR #336 second-pass review). Also
// subsumes the batch-existence check for both write paths. This runs inside the
// caller's transaction but is not synchronized with concurrent facility-tier
// promotion; the residual race is tracked separately.
async function requireBatchTierEvidence(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  values: {
    randomReflectanceR0Percent: number | null;
    sReflectanceFraction: number | null;
    reactiveCarbonPercent: number | null;
    residualCarbonPercent: number | null;
  },
): Promise<void> {
  // Tier is inherited from the batch's facility (ADR 0021), not a batch column.
  const [creditBatch] = await tx
    .select({ durabilityOption: facilities.durabilityOption })
    .from(creditBatches)
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatches.id, creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)));

  if (!creditBatch) {
    throw new SafeError("Credit batch not found");
  }
  if (creditBatch.durabilityOption !== "1000_year") {
    return;
  }
  if (values.randomReflectanceR0Percent == null) {
    throw new SafeError(
      "R₀ reflectance is required for a Sample on a 1000-year credit batch.",
    );
  }
  if (
    values.reactiveCarbonPercent == null &&
    values.residualCarbonPercent == null
  ) {
    throw new SafeError(
      "TGA non-reactive carbon is required for a Sample on a 1000-year credit batch.",
    );
  }
  if (values.sReflectanceFraction == null) {
    throw new SafeError(
      "R₀ readings at or above 2% are required for a Sample on a 1000-year credit batch.",
    );
  }
}

/**
 * Create a new sample
 */
export async function createSample(
  ctx: OrgContext,
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
    sReflectanceFraction?: number | null;
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
  requireOrgScope(ctx);
  await assertSameOrg(ctx, creditBatches, data.creditBatchId);

  // Sample-code uniqueness is DB-enforced (issue #395: `samples_sample_code_unique`).
  // No racy pre-check — a colliding auto-generated code is retried by
  // `withAutoCode`; a user-supplied duplicate surfaces via that same guard.
  const sample = await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "creditBatch", entityId: data.creditBatchId },
      "create",
      "sample",
    );

    // Verify the batch exists and enforce its declared tier's evidence
    // requirements (tier read from the batch, never from the client) —
    // inside the transaction so the write sees the same tier as the check.
    await requireBatchTierEvidence(ctx, tx, data.creditBatchId, {
      randomReflectanceR0Percent: data.randomReflectanceR0Percent ?? null,
      sReflectanceFraction: data.sReflectanceFraction ?? null,
      reactiveCarbonPercent: data.reactiveCarbonPercent ?? null,
      residualCarbonPercent: data.residualCarbonPercent ?? null,
    });

    const [created] = await tx
      .insert(samples)
      .values({
        organizationId: ctx.organizationId,
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
        sReflectanceFraction: data.sReflectanceFraction ?? null,
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

  return getSampleById(ctx, sample.id);
}

/**
 * Update an existing sample
 */
export async function updateSample(
  ctx: OrgContext,
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
    sReflectanceFraction?: number | null;
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
  requireOrgScope(ctx);
  if (data.creditBatchId) {
    await assertSameOrg(ctx, creditBatches, data.creditBatchId);
  }

  // Verify sample exists
  const [existing] = await db
    .select()
    .from(samples)
    .where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Sample not found");
  }

  // Fast-fail before opening a transaction; the locked check below is authoritative.
  assertCarbonReconciliation(existing, data);

  // Sample-code uniqueness is DB-enforced (issue #395). No racy pre-check —
  // a user-supplied duplicate is mapped to a friendly SafeError by the
  // `guardSampleMutation` wrapper around the write below.

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
  if (data.sReflectanceFraction !== undefined) updateData.sReflectanceFraction = data.sReflectanceFraction;
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

  await guardSampleMutation(() => db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(samples)
      .where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)))
      .for("update");

    if (!locked) {
      throw new SafeError("Sample not found");
    }
    assertCarbonReconciliation(locked, data);

    await assertCanMutateCertifiedLineage(
      ctx,
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
        ctx,
        tx,
        { entityType: "creditBatch", entityId: data.creditBatchId },
        "update",
        "sample",
        "selected",
      );
    }

    // Enforce the 1000-year evidence invariant against the EFFECTIVE
    // post-update state (update merged over the LOCKED row) and the
    // effective batch — covers nulling out R₀/TGA in place as well as moving
    // the sample onto a 1000-year batch. Runs inside the transaction so the
    // write sees the same tier as the check. Legacy batchless rows skip
    // (their tier is inferred from R₀ presence on read).
    // Merges over `locked`, not `existing`: `existing` is the pre-transaction
    // snapshot, so two concurrent partial updates (one nulling R₀, one nulling
    // sReflectance) would each still see the other field populated and both
    // pass. Must stay consistent with assertCarbonReconciliation above, which
    // is asserted against the same locked row.
    const effectiveCreditBatchId =
      data.creditBatchId ?? locked.creditBatchId;
    if (effectiveCreditBatchId) {
      await requireBatchTierEvidence(ctx, tx, effectiveCreditBatchId, {
        randomReflectanceR0Percent:
          data.randomReflectanceR0Percent !== undefined
            ? data.randomReflectanceR0Percent
            : locked.randomReflectanceR0Percent,
        sReflectanceFraction:
          data.sReflectanceFraction !== undefined
            ? data.sReflectanceFraction
            : locked.sReflectanceFraction,
        reactiveCarbonPercent:
          data.reactiveCarbonPercent !== undefined
            ? data.reactiveCarbonPercent
            : locked.reactiveCarbonPercent,
        residualCarbonPercent:
          data.residualCarbonPercent !== undefined
            ? data.residualCarbonPercent
            : locked.residualCarbonPercent,
      });
    }

    await tx.update(samples).set(updateData).where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)));
  }));

  return getSampleById(ctx, sampleId);
}

// ============================================
// Sample Delete Operations
// ============================================

/**
 * Delete a sample
 */
export async function deleteSample(
  ctx: OrgContext,
  sampleId: string
): Promise<void> {
  requireOrgScope(ctx);

  await guardSampleMutation(() => db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "sample", entityId: sampleId },
      "delete",
    );

    const transportLegDocuments = await deleteTransportLegsForEntity(
      ctx,
      tx,
      "sample",
      sampleId,
    );
    const deleted = await tx
      .delete(samples)
      .where(and(eq(samples.id, sampleId), eq(samples.organizationId, ctx.organizationId)))
      .returning({ id: samples.id });
    if (deleted.length === 0) {
      throw new SafeError("Sample not found");
    }
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "sample", entityId: sampleId },
      ...transportLegDocuments,
    ]);
  }));
  await processPendingStorageObjectDeletions(ctx);
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a sample code is available
 */
export async function isSampleCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeSampleId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(samples.organizationId, ctx.organizationId),
    eq(samples.sampleCode, code),
  ];

  if (excludeSampleId) {
    conditions.push(sql`${samples.id} != ${excludeSampleId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
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
export async function generateNextSampleCode(ctx: OrgContext): Promise<string> {
  requireOrgScope(ctx);

  const year = new Date().getFullYear();
  const prefix = `S-${year}-`;

  const [lastSample] = await db
    .select({ sampleCode: samples.sampleCode })
    .from(samples)
    .where(and(eq(samples.organizationId, ctx.organizationId), ilike(samples.sampleCode, `${prefix}%`)))
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
  ctx: OrgContext,
  creditBatchId?: string
): Promise<Array<{ id: string; sampleCode: string; samplingTime: Date }>> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(samples.organizationId, ctx.organizationId)];
  if (creditBatchId) {
    conditions.push(eq(samples.creditBatchId, creditBatchId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // org-scope-ok: whereClause includes the active organization predicate.
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
