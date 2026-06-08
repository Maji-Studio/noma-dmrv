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
  lte,
  sql,
  SQL,
  count,
  sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
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
import { requireAuth } from "../utils";
import { SafeError } from "@/lib/errors";
import type { ProductionRunFilterData } from "@/schemas/production-runs";
import type {
  ProductionRunFeedstockWithDetails,
  ProductionRunWithRelations,
  PaginatedProductionRuns,
  ProductionRunStats,
  FacilityEnergyTotals,
  ProductionRunWithSamples,
} from "./types";

/**
 * Get all production runs with pagination and filtering
 * Supports search, facility/reactor filter, date range, sorting, and pagination
 */
export async function getProductionRuns(
  userId: string,
  filters?: Partial<ProductionRunFilterData>
): Promise<PaginatedProductionRuns> {
  requireAuth(userId);

  const {
    search,
    facilityId,
    reactorId,
    status,
    startDate,
    endDate,
    page = 1,
    pageSize = 20,
    sortBy = "date",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(productionRuns.code, searchPattern));
  }

  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  if (reactorId) {
    conditions.push(eq(productionRuns.reactorId, reactorId));
  }

  if (status) {
    conditions.push(eq(productionRuns.status, status));
  }

  if (startDate) {
    conditions.push(gte(productionRuns.date, startDate.toISOString().split('T')[0]));
  }

  if (endDate) {
    conditions.push(lte(productionRuns.date, endDate.toISOString().split('T')[0]));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: productionRuns.code,
    date: productionRuns.date,
    status: productionRuns.status,
    biocharOutputKg: productionRuns.biocharOutputKg,
    createdAt: productionRuns.createdAt,
    updatedAt: productionRuns.updatedAt,
  }[sortBy] ?? productionRuns.date;

  const orderFn = sortOrder === "asc" ? asc : desc;

  // Count total for pagination
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
      date: productionRuns.date,
      status: productionRuns.status,
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
      plcDataFileUrl: productionRuns.plcDataFileUrl,
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
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .leftJoin(reactors, eq(productionRuns.reactorId, reactors.id))
    .leftJoin(operators, eq(productionRuns.operatorId, operators.id))
    .leftJoin(biocharStorage, eq(productionRuns.biocharStorageLocationId, biocharStorage.id))
    .leftJoin(feedstockStorage, eq(productionRuns.feedstockStorageLocationId, feedstockStorage.id))
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
        .leftJoin(feedstocks, eq(productionRunFeedstocks.feedstockId, feedstocks.id))
        .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
        .where(inArray(productionRunFeedstocks.productionRunId, runIds))
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
    .leftJoin(feedstocks, eq(productionRunFeedstocks.feedstockId, feedstocks.id))
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .where(eq(productionRunFeedstocks.productionRunId, productionRunId));

  return result;
}

/**
 * Get a single production run by ID
 * Returns run data with all relations
 */
export async function getProductionRunById(
  userId: string,
  productionRunId: string
): Promise<ProductionRunWithRelations> {
  requireAuth(userId);

  const [run] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      date: productionRuns.date,
      status: productionRuns.status,
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
      plcDataFileUrl: productionRuns.plcDataFileUrl,
      createdAt: productionRuns.createdAt,
      updatedAt: productionRuns.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      reactorCode: reactors.code,
      reactorIdentifier: reactors.identifier,
      operatorName: operators.name,
    })
    .from(productionRuns)
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .leftJoin(reactors, eq(productionRuns.reactorId, reactors.id))
    .leftJoin(operators, eq(productionRuns.operatorId, operators.id))
    .where(eq(productionRuns.id, productionRunId));

  if (!run) {
    throw new SafeError("Production run not found");
  }

  const [runFeedstocks, biocharStorageLocation, feedstockStorageLocation] =
    await Promise.all([
      getProductionRunFeedstocks(productionRunId),
      run.biocharStorageLocationId
        ? db
            .select({ code: storageLocations.code })
            .from(storageLocations)
            .where(eq(storageLocations.id, run.biocharStorageLocationId))
            .then(([loc]) => loc?.code ?? null)
        : null,
      run.feedstockStorageLocationId
        ? db
            .select({ code: storageLocations.code })
            .from(storageLocations)
            .where(eq(storageLocations.id, run.feedstockStorageLocationId))
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
  userId: string,
  facilityId?: string
): Promise<ProductionRunStats> {
  requireAuth(userId);

  const conditions: SQL[] = [];
  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalRuns: count(),
      totalBiocharKg: sum(productionRuns.biocharOutputKg),
    })
    .from(productionRuns)
    .where(whereClause);

  // Get total feedstock mass
  const [feedstockStats] = await db
    .select({
      totalFeedstockKg: sum(productionRunFeedstocks.massUsedKg),
    })
    .from(productionRunFeedstocks)
    .leftJoin(productionRuns, eq(productionRunFeedstocks.productionRunId, productionRuns.id))
    .where(whereClause);

  // Get status counts in a single GROUP BY query
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
    totalRuns: Number(stats.totalRuns),
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
  userId: string,
  facilityId: string
): Promise<FacilityEnergyTotals> {
  requireAuth(userId);

  const [row] = await db
    .select({
      runCount: count(),
      electricityKwh: sum(productionRuns.electricityKwh),
      gensetLitres: sum(productionRuns.dieselGensetLiters),
      operationLitres: sum(productionRuns.dieselOperationLiters),
      preprocessingLitres: sum(productionRuns.preprocessingFuelLiters),
    })
    .from(productionRuns)
    .where(eq(productionRuns.facilityId, facilityId));

  return {
    runCount: Number(row.runCount),
    electricityKwh: Number(row.electricityKwh) || 0,
    gensetLitres: Number(row.gensetLitres) || 0,
    startupLitres:
      (Number(row.operationLitres) || 0) +
      (Number(row.preprocessingLitres) || 0),
  };
}

/**
 * Check if a production run code is available
 */
export async function isProductionRunCodeAvailable(
  userId: string,
  code: string,
  excludeRunId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(productionRuns.code, code)];

  if (excludeRunId) {
    conditions.push(sql`${productionRuns.id} != ${excludeRunId}`);
  }

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
  userId: string,
  runIds: string[]
): Promise<ProductionRunWithSamples[]> {
  requireAuth(userId);
  if (runIds.length === 0) return [];

  const runs = await db
    .select()
    .from(productionRuns)
    .where(inArray(productionRuns.id, runIds));
  if (runs.length === 0) return [];

  const sampleRows = await db
    .select()
    .from(samples)
    .where(
      inArray(
        samples.productionRunId,
        runs.map((r) => r.id)
      )
    );

  const samplesByRun = new Map<string, Sample[]>();
  for (const s of sampleRows) {
    const list = samplesByRun.get(s.productionRunId) ?? [];
    list.push(s);
    samplesByRun.set(s.productionRunId, list);
  }

  return runs.map((r) => ({ ...r, samples: samplesByRun.get(r.id) ?? [] }));
}

/**
 * Get production run options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getProductionRunOptions(
  userId: string
): Promise<Array<{ id: string; code: string; date: string; status: string }>> {
  requireAuth(userId);

  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
      status: productionRuns.status,
    })
    .from(productionRuns)
    .orderBy(desc(productionRuns.date));
}
