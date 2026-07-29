/**
 * Production-run read operations: list/pagination, by-id, stats, energy totals,
 * sample bulk-load, and dropdown options.
 */

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  sql,
  SQL,
  count,
  sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { formatLocalDate } from "@/lib/date-utils";
import {
  productionRuns,
  productionRunFeedstocks,
  facilities,
  reactors,
  operators,
  storageLocations,
  feedstocks,
  feedstockTypes,
  samples,
  type Sample,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";
import { SafeError } from "@/lib/errors";
import { productionRunDateExpr } from "./date-expr";
import { inCreditBatchProductionRuns } from "../credit-batch-lineage-filter";
import type { ProductionRunFilterData } from "@/schemas/production-runs";
import type {
  ProductionRunFeedstockWithDetails,
  ProductionRunWithRelations,
  PaginatedProductionRuns,
  ProductionRunStats,
  FacilityEnergyTotals,
  ProductionRunWithSamples,
} from "./types";
import {
  CANCELLED_PRODUCTION_RUN_STATUS,
  COMPLETED_PRODUCTION_RUN_STATUS,
} from "@/lib/production-runs/lifecycle";

/**
 * Get all production runs with pagination and filtering
 * Supports search, facility/reactor filter, date range, sorting, and pagination
 */
export async function getProductionRuns(
  ctx: OrgContext,
  filters?: Partial<ProductionRunFilterData>
): Promise<PaginatedProductionRuns> {
  requireOrgScope(ctx);

  const {
    ids,
    search,
    facilityId,
    creditBatchId,
    reactorId,
    status,
    startDate,
    endDate,
    page = 1,
    pageSize = 20,
    sortBy = "date",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions — archived runs (facility archive cascade) are hidden
  const conditions: SQL[] = [
    eq(productionRuns.organizationId, ctx.organizationId),
    isNull(productionRuns.archivedAt),
  ];

  if (ids?.length) {
    conditions.push(inArray(productionRuns.id, ids));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(productionRuns.code, searchPattern));
  }

  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  if (creditBatchId) {
    conditions.push(
      inCreditBatchProductionRuns(ctx, creditBatchId, productionRuns.id),
    );
  }

  if (reactorId) {
    conditions.push(eq(productionRuns.reactorId, reactorId));
  }

  if (status) {
    conditions.push(eq(productionRuns.status, status));
  }

  if (startDate) {
    // Inclusive-day range on the run's calendar date (derived from start_time).
    conditions.push(gte(productionRunDateExpr(), formatLocalDate(startDate)));
  }

  if (endDate) {
    conditions.push(lte(productionRunDateExpr(), formatLocalDate(endDate)));
  }

  const whereClause = and(...conditions);

  // Build sort clause. The "date" sort key now orders by start_time (the run's
  // instant), which sorts identically to the old date column but breaks ties.
  const sortColumn = {
    code: productionRuns.code,
    date: productionRuns.startTime,
    status: productionRuns.status,
    biocharOutputKg: productionRuns.biocharOutputKg,
    createdAt: productionRuns.createdAt,
    updatedAt: productionRuns.updatedAt,
  }[sortBy] ?? productionRuns.startTime;

  const orderFn = sortOrder === "asc" ? asc : desc;

  // Count total for pagination
  // org-scope-ok: whereClause includes the active organization predicate.
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(productionRuns)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Alias storage locations for biochar and feedstock joins
  const biocharStorage = alias(storageLocations, "biocharStorage");
  const feedstockStorage = alias(storageLocations, "feedstockStorage");

  // Get production runs with all relations in a single query (no N+1 for storage locations)
  const runList = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      date: productionRunDateExpr(),
      status: productionRuns.status,
      cancellationReason: productionRuns.cancellationReason,
      startTime: productionRuns.startTime,
      endTime: productionRuns.endTime,
      reactorId: productionRuns.reactorId,
      operatorId: productionRuns.operatorId,
      feedingRateKgHr: productionRuns.feedingRateKgHr,
      residenceTimeMinutes: productionRuns.residenceTimeMinutes,
      dieselOperationLiters: productionRuns.dieselOperationLiters,
      dieselGensetLiters: productionRuns.dieselGensetLiters,
      preprocessingFuelLiters: productionRuns.preprocessingFuelLiters,
      electricityKwh: productionRuns.electricityKwh,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharMoisturePercent: productionRuns.biocharMoisturePercent,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
      feedstockStorageLocationId: productionRuns.feedstockStorageLocationId,
      feedstockWetMassKg: productionRuns.feedstockWetMassKg,
      feedstockMoisturePercent: productionRuns.feedstockMoisturePercent,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
      createdAt: productionRuns.createdAt,
      updatedAt: productionRuns.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      reactorCode: reactors.code,
      reactorIdentifier: reactors.identifier,
      operatorName: operators.name,
      biocharStorageLocationCode: biocharStorage.code,
      feedstockStorageLocationCode: feedstockStorage.code,
    })
    .from(productionRuns)
    .leftJoin(facilities, and(eq(productionRuns.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(reactors, and(eq(productionRuns.reactorId, reactors.id), eq(reactors.organizationId, ctx.organizationId)))
    .leftJoin(operators, and(eq(productionRuns.operatorId, operators.id), eq(operators.organizationId, ctx.organizationId)))
    .leftJoin(biocharStorage, and(eq(productionRuns.biocharStorageLocationId, biocharStorage.id), eq(biocharStorage.organizationId, ctx.organizationId)))
    .leftJoin(feedstockStorage, and(eq(productionRuns.feedstockStorageLocationId, feedstockStorage.id), eq(feedstockStorage.organizationId, ctx.organizationId)))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Batch-fetch feedstocks for all runs in a single query (instead of N queries)
  const runIds = runList.map((r) => r.id);
  const allFeedstocks = runIds.length > 0
    ? await db
        .select({
          id: productionRunFeedstocks.id,
          productionRunId: productionRunFeedstocks.productionRunId,
          feedstockId: productionRunFeedstocks.feedstockId,
          massUsedKg: productionRunFeedstocks.massUsedKg,
          feedstockCode: feedstocks.code,
          feedstockTypeName: feedstockTypes.name,
        })
        .from(productionRunFeedstocks)
        .leftJoin(feedstocks, and(eq(productionRunFeedstocks.feedstockId, feedstocks.id), eq(feedstocks.organizationId, ctx.organizationId)))
        .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
        .where(and(inArray(productionRunFeedstocks.productionRunId, runIds), eq(productionRunFeedstocks.organizationId, ctx.organizationId)))
    : [];
  // Group feedstocks by production run ID
  const feedstocksByRunId = new Map<string, ProductionRunFeedstockWithDetails[]>();
  for (const f of allFeedstocks) {
    const existing = feedstocksByRunId.get(f.productionRunId) ?? [];
    existing.push(f);
    feedstocksByRunId.set(f.productionRunId, existing);
  }
  const items: ProductionRunWithRelations[] = runList.map((run) => {
    const runFeedstocks = feedstocksByRunId.get(run.id) ?? [];
    return {
      ...run,
      biocharStorageLocationCode: run.biocharStorageLocationCode ?? null,
      feedstockStorageLocationCode: run.feedstockStorageLocationCode ?? null,
      feedstocks: runFeedstocks,
      totalFeedstockMassKg: runFeedstocks.reduce((s, f) => s + f.massUsedKg, 0),
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get feedstocks for a production run
 */
async function getProductionRunFeedstocks(
  ctx: OrgContext,
  productionRunId: string
): Promise<ProductionRunFeedstockWithDetails[]> {
  const result = await db
    .select({
      id: productionRunFeedstocks.id,
      feedstockId: productionRunFeedstocks.feedstockId,
      massUsedKg: productionRunFeedstocks.massUsedKg,
      feedstockCode: feedstocks.code,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(productionRunFeedstocks)
    .leftJoin(feedstocks, and(eq(productionRunFeedstocks.feedstockId, feedstocks.id), eq(feedstocks.organizationId, ctx.organizationId)))
    .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstocks.productionRunId, productionRunId), eq(productionRunFeedstocks.organizationId, ctx.organizationId)));

  return result;
}

/**
 * Get a single production run by ID
 * Returns run data with all relations
 */
export async function getProductionRunById(
  ctx: OrgContext,
  productionRunId: string
): Promise<ProductionRunWithRelations> {
  requireOrgScope(ctx);

  const [run] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      date: productionRunDateExpr(),
      status: productionRuns.status,
      cancellationReason: productionRuns.cancellationReason,
      startTime: productionRuns.startTime,
      endTime: productionRuns.endTime,
      reactorId: productionRuns.reactorId,
      operatorId: productionRuns.operatorId,
      feedingRateKgHr: productionRuns.feedingRateKgHr,
      residenceTimeMinutes: productionRuns.residenceTimeMinutes,
      dieselOperationLiters: productionRuns.dieselOperationLiters,
      dieselGensetLiters: productionRuns.dieselGensetLiters,
      preprocessingFuelLiters: productionRuns.preprocessingFuelLiters,
      electricityKwh: productionRuns.electricityKwh,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharMoisturePercent: productionRuns.biocharMoisturePercent,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
      feedstockStorageLocationId: productionRuns.feedstockStorageLocationId,
      feedstockWetMassKg: productionRuns.feedstockWetMassKg,
      feedstockMoisturePercent: productionRuns.feedstockMoisturePercent,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
      createdAt: productionRuns.createdAt,
      updatedAt: productionRuns.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      reactorCode: reactors.code,
      reactorIdentifier: reactors.identifier,
      operatorName: operators.name,
    })
    .from(productionRuns)
    .leftJoin(facilities, and(eq(productionRuns.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(reactors, and(eq(productionRuns.reactorId, reactors.id), eq(reactors.organizationId, ctx.organizationId)))
    .leftJoin(operators, and(eq(productionRuns.operatorId, operators.id), eq(operators.organizationId, ctx.organizationId)))
    .where(
      and(
        eq(productionRuns.id, productionRunId),
        eq(productionRuns.organizationId, ctx.organizationId),
        isNull(productionRuns.archivedAt),
      ),
    );

  if (!run) {
    throw new SafeError("Production run not found");
  }

  const [
    runFeedstocks,
    biocharStorageLocation,
    feedstockStorageLocation,
  ] =
    await Promise.all([
      getProductionRunFeedstocks(ctx, productionRunId),
      run.biocharStorageLocationId
        ? db
            .select({ code: storageLocations.code })
            .from(storageLocations)
            .where(and(eq(storageLocations.id, run.biocharStorageLocationId), eq(storageLocations.organizationId, ctx.organizationId)))
            .then(([loc]) => loc?.code ?? null)
        : null,
      run.feedstockStorageLocationId
        ? db
            .select({ code: storageLocations.code })
            .from(storageLocations)
            .where(and(eq(storageLocations.id, run.feedstockStorageLocationId), eq(storageLocations.organizationId, ctx.organizationId)))
            .then(([loc]) => loc?.code ?? null)
        : null,
    ]);

  return {
    ...run,
    biocharStorageLocationCode: biocharStorageLocation,
    feedstockStorageLocationCode: feedstockStorageLocation,
    feedstocks: runFeedstocks,
    totalFeedstockMassKg: runFeedstocks.reduce((sum, f) => sum + f.massUsedKg, 0),
  };
}

/**
 * Get production run statistics
 * Returns aggregated stats for dashboard display
 */
export async function getProductionRunStats(
  ctx: OrgContext,
  facilityId?: string
): Promise<ProductionRunStats> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(productionRuns.organizationId, ctx.organizationId),
    isNull(productionRuns.archivedAt),
    ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
  ];
  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  const whereClause = and(...conditions);
  const completedWhereClause = and(
    ...conditions,
    eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
  );

  // org-scope-ok: whereClause includes the active organization predicate.
  const [stats] = await db
    .select({
      totalBiocharKg: sum(productionRuns.biocharOutputKg),
    })
    .from(productionRuns)
    .where(completedWhereClause);

  // Get total feedstock mass
  const [feedstockStats] = await db
    .select({
      totalFeedstockKg: sum(productionRunFeedstocks.massUsedKg),
    })
    .from(productionRunFeedstocks)
    .leftJoin(productionRuns, and(eq(productionRunFeedstocks.productionRunId, productionRuns.id), eq(productionRunFeedstocks.organizationId, ctx.organizationId)))
    .where(and(completedWhereClause, eq(productionRunFeedstocks.organizationId, ctx.organizationId)));

  // Get status counts in a single GROUP BY query
  // org-scope-ok: whereClause includes the active organization predicate.
  const statusCounts = await db
    .select({
      status: productionRuns.status,
      count: count(),
    })
    .from(productionRuns)
    .where(whereClause)
    .groupBy(productionRuns.status);

  const statusMap = Object.fromEntries(
    statusCounts.map((row) => [row.status, Number(row.count)])
  );

  return {
    totalRuns: statusCounts.reduce((total, row) => total + Number(row.count), 0),
    totalBiocharKg: Number(stats.totalBiocharKg) || 0,
    totalFeedstockKg: Number(feedstockStats.totalFeedstockKg) || 0,
    runningCount: statusMap["running"] ?? 0,
    completedCount: statusMap["complete"] ?? 0,
    draftCount: statusMap["draft"] ?? 0,
  };
}

/**
 * Sum electricity + diesel across every production run for a facility.
 * Aggregates in SQL so the totals are not capped by list pagination.
 */
export async function getFacilityEnergyTotals(
  ctx: OrgContext,
  facilityId: string
): Promise<FacilityEnergyTotals> {
  requireOrgScope(ctx);

  const [row] = await db
    .select({
      runCount: count(),
      electricityKwh: sum(productionRuns.electricityKwh),
      gensetLitres: sum(productionRuns.dieselGensetLiters),
      operationLitres: sum(productionRuns.dieselOperationLiters),
      preprocessingLitres: sum(productionRuns.preprocessingFuelLiters),
    })
    .from(productionRuns)
    .where(and(
      eq(productionRuns.facilityId, facilityId),
      eq(productionRuns.organizationId, ctx.organizationId),
      isNull(productionRuns.archivedAt),
      ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
    ));

  return {
    runCount: Number(row.runCount),
    electricityKwh: Number(row.electricityKwh) || 0,
    // Genset ("summarized") = generator diesel + preprocessing fuel; startup =
    // reactor-startup / plant diesel only. Mirrors the submission split in
    // aggregation.ts (docs/isometric/changes.md).
    gensetLitres:
      (Number(row.gensetLitres) || 0) + (Number(row.preprocessingLitres) || 0),
    startupLitres: Number(row.operationLitres) || 0,
  };
}

/**
 * Check if a production run code is available
 */
export async function isProductionRunCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeRunId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(productionRuns.organizationId, ctx.organizationId),
    eq(productionRuns.code, code),
  ];

  if (excludeRunId) {
    conditions.push(sql`${productionRuns.id} != ${excludeRunId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(and(...conditions));

  return !existing;
}

// Bulk loader used by the Certify submission orchestrator. Joins the lab-grade
// `samples` table (carbon %, H/C and O/C ratios, ash) — NOT `productionSamples`,
// which holds in-process proximate analysis. Runs missing from the lookup are
// silently dropped; aggregation reports a per-run warning rather than failing.
export async function getProductionRunsWithSamples(
  ctx: OrgContext,
  runIds: string[]
): Promise<ProductionRunWithSamples[]> {
  requireOrgScope(ctx);
  if (runIds.length === 0) return [];

  const runs = await db
    .select()
    .from(productionRuns)
    .where(and(inArray(productionRuns.id, runIds), eq(productionRuns.organizationId, ctx.organizationId)));
  if (runs.length === 0) return [];

  const sampleRows = await db
    .select()
    .from(samples)
    .where(
      and(
        inArray(samples.productionRunId, runs.map((r) => r.id)),
        eq(samples.organizationId, ctx.organizationId),
      )
    );

  const samplesByRun = new Map<string, Sample[]>();
  for (const s of sampleRows) {
    // productionRunId is nullable since ADR 0016 (provenance, not the primary
    // link). The query filters on it being in `runs`, so it is non-null here;
    // the guard satisfies the type and skips any commingled-batch sample.
    if (s.productionRunId == null) continue;
    const list = samplesByRun.get(s.productionRunId) ?? [];
    list.push(s);
    samplesByRun.set(s.productionRunId, list);
  }
  return runs.map((r) => ({
    ...r,
    samples: samplesByRun.get(r.id) ?? [],
  }));
}

/**
 * Get production run options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getProductionRunOptions(
  ctx: OrgContext
): Promise<Array<{ id: string; code: string; date: string; status: string }>> {
  requireOrgScope(ctx);

  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
      status: productionRuns.status,
    })
    .from(productionRuns)
    .where(and(isNull(productionRuns.archivedAt), eq(productionRuns.organizationId, ctx.organizationId)))
    .orderBy(desc(productionRuns.startTime));
}
