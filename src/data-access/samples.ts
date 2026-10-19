/**
 * Samples Data Access Layer
 * Reads for lab samples with org scoping, pagination, and filtering, plus the
 * direct write entry points. A Sample anchors on ONE credit batch (the
 * protocol production batch) per Isometric Protocol Section 8.3 / issue #309;
 * the production-run column is legacy provenance only (pre-re-grain rows) and
 * is no longer written.
 *
 * The writers live in `./samples/`: `*InTransaction` functions run inside the
 * operation runner's transaction (`src/lib/operations/lab-samples.ts`, which
 * the Server Actions and the API both call). `createSample`, `updateSample`
 * and `deleteSample` below run the same writers in a transaction of their own,
 * for scripts and database tests.
 */

import { and, asc, count, desc, eq, gte, ilike, lte, SQL } from "drizzle-orm";
import { db } from "@/db";
import { avgNumeric } from "@/db/aggregate";
import { creditBatches, samples } from "@/db/schema";
import type { SampleFilterData } from "@/schemas/samples";
import type { OrgContext } from "@/lib/auth/server";
import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "./code-generator";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import { requireOrgScope } from "./utils";
import { createSampleInTransaction } from "./samples/create";
import { deleteSampleInTransaction } from "./samples/delete";
import {
  getSampleById,
  sampleBatchFacilities,
  sampleWithRelationsColumns,
  toSampleWithRelations,
  type SampleWithRelations,
} from "./samples/sample-by-id";
import { updateSampleInTransaction } from "./samples/update";
import type { CreateSampleRequest, UpdateSampleRequest } from "./samples/write-values";

export { getSampleById, type SampleWithRelations };
export { createSampleInTransaction, deleteSampleInTransaction, updateSampleInTransaction };
export type { CreateSampleRequest, SampleWriteResult, UpdateSampleRequest } from "./samples/write-values";

// ============================================
// Types
// ============================================


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
    conditions.push(eq(creditBatches.facilityId, facilityId));
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
    .innerJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get samples with relations
  const sampleList = await db
    .select(sampleWithRelationsColumns)
    .from(samples)
    .innerJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(sampleBatchFacilities, and(eq(creditBatches.facilityId, sampleBatchFacilities.id), eq(sampleBatchFacilities.organizationId, ctx.organizationId)))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  const items: SampleWithRelations[] = sampleList.map(toSampleWithRelations);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
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
    conditions.push(eq(creditBatches.facilityId, facilityId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalSamples: count(),
      avgCarbonPercent: avgNumeric(samples.totalCarbonPercent),
      avgOrganicCarbonPercent: avgNumeric(samples.organicCarbonPercent),
    })
    .from(samples)
    .innerJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .where(whereClause);

  // Count 1000-year samples using the facility tier (ADR 0021).
  const is1000Year = eq(sampleBatchFacilities.durabilityOption, "1000_year");
  const [samples1000Year] = await db
    .select({ count: count() })
    .from(samples)
    .innerJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(sampleBatchFacilities, and(eq(creditBatches.facilityId, sampleBatchFacilities.id), eq(sampleBatchFacilities.organizationId, ctx.organizationId)))
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
// Direct write entry points
// ============================================

/**
 * Create a Sample with a given code in a transaction of its own. A duplicate
 * code surfaces as the raw unique violation, so a `withAutoCode` caller can
 * retry it with the next code.
 */
export async function createSample(ctx: OrgContext, data: CreateSampleRequest): Promise<SampleWithRelations> {
  requireOrgScope(ctx);
  const result = await db.transaction((tx) => createSampleInTransaction(ctx, tx, data));
  return result.sample;
}

/** Update a Sample in a transaction of its own; an edited duplicate code is a `conflict`. */
export async function updateSample(ctx: OrgContext, sampleId: string, data: UpdateSampleRequest): Promise<SampleWithRelations> {
  requireOrgScope(ctx);
  const result = await withUniqueCodeGuard(ctx, samples, samples.sampleCode, CODE_CONFLICT_MESSAGES.sample,
    () => db.transaction((tx) => updateSampleInTransaction(ctx, tx, sampleId, data)));
  return result.sample;
}

/** Delete a Sample in a transaction of its own, then drain the storage deletions it queued. */
export async function deleteSample(ctx: OrgContext, sampleId: string, expectedVersion: number): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction((tx) => deleteSampleInTransaction(ctx, tx, sampleId, expectedVersion, "form"));
  await processPendingStorageObjectDeletions(ctx);
}
