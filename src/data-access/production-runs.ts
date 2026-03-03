/**
 * Production Runs Data Access Layer
 * CRUD operations for production runs with auth guards, pagination, and filtering
 * Includes M:M relationship handling for feedstocks
 */

import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, SQL, count, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  productionRuns,
  productionRunFeedstocks,
  productionRunReadings,
  facilities,
  reactors,
  operators,
  storageLocations,
  feedstocks,
  feedstockTypes,
} from "@/db/schema";
import type { ProductionRunFilterData, ProductionRunFeedstockData } from "@/schemas/production-runs";

// ============================================
// Types
// ============================================

export interface ProductionRunFeedstockWithDetails {
  id: string;
  feedstockId: string;
  massUsedKg: number;
  feedstockCode: string | null;
  feedstockTypeName: string | null;
}

export interface ProductionRunWithRelations {
  id: string;
  code: string;
  facilityId: string;
  date: string;
  status: "draft" | "running" | "complete" | "void";
  startTime: Date;
  endTime: Date;
  reactorId: string;
  operatorId: string | null;
  feedingRateKgHr: number | null;
  residenceTimeMinutes: number | null;
  dieselOperationLiters: number | null;
  dieselGensetLiters: number | null;
  preprocessingFuelLiters: number | null;
  electricityKwh: number | null;
  biocharOutputKg: number | null;
  biocharStorageLocationId: string | null;
  feedstockStorageLocationId: string | null;
  emissionFactorsUsed: unknown | null;
  plcDataFileUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  facilityCode: string | null;
  facilityName: string | null;
  reactorCode: string | null;
  reactorIdentifier: string | null;
  operatorName: string | null;
  biocharStorageLocationCode: string | null;
  feedstockStorageLocationCode: string | null;
  // M:M feedstocks
  feedstocks: ProductionRunFeedstockWithDetails[];
  // Computed fields
  totalFeedstockMassKg: number;
}

export interface PaginatedProductionRuns {
  items: ProductionRunWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProductionRunStats {
  totalRuns: number;
  totalBiocharKg: number;
  totalFeedstockKg: number;
  runningCount: number;
  completedCount: number;
  draftCount: number;
}

export interface ProductionRunReadingRecord {
  id: string;
  productionRunId: string;
  timestamp: Date;
  temperatureC: number | null;
  pressureBar: number | null;
  gasFlowRate: number | null;
  createdAt: Date;
}

// ============================================
// Auth Guards
// ============================================

import { requireAuth } from "./utils";

// ============================================
// Production Run Read Operations
// ============================================

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
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
      feedstockStorageLocationId: productionRuns.feedstockStorageLocationId,
      emissionFactorsUsed: productionRuns.emissionFactorsUsed,
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
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
      feedstockStorageLocationId: productionRuns.feedstockStorageLocationId,
      emissionFactorsUsed: productionRuns.emissionFactorsUsed,
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
    throw new Error("Production run not found");
  }

  const runFeedstocks = await getProductionRunFeedstocks(productionRunId);
  const biocharStorageLocation = run.biocharStorageLocationId
    ? await db
        .select({ code: storageLocations.code })
        .from(storageLocations)
        .where(eq(storageLocations.id, run.biocharStorageLocationId))
        .then(([loc]) => loc?.code ?? null)
    : null;
  const feedstockStorageLocation = run.feedstockStorageLocationId
    ? await db
        .select({ code: storageLocations.code })
        .from(storageLocations)
        .where(eq(storageLocations.id, run.feedstockStorageLocationId))
        .then(([loc]) => loc?.code ?? null)
    : null;

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
 * Get production run readings (time-series data)
 */
export async function getProductionRunReadings(
  userId: string,
  productionRunId: string
): Promise<ProductionRunReadingRecord[]> {
  requireAuth(userId);

  // Verify run exists
  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, productionRunId));

  if (!run) {
    throw new Error("Production run not found");
  }

  return db
    .select()
    .from(productionRunReadings)
    .where(eq(productionRunReadings.productionRunId, productionRunId))
    .orderBy(asc(productionRunReadings.timestamp));
}

// ============================================
// Production Run Create Operations
// ============================================

/**
 * Create a new production run with feedstocks
 */
export async function createProductionRun(
  userId: string,
  data: {
    code: string;
    facilityId: string;
    date: Date;
    reactorId: string;
    status?: "draft" | "running" | "complete" | "void";
    startTime: Date;
    endTime: Date;
    operatorId?: string | null;
    feedstocks: ProductionRunFeedstockData[];
    feedingRateKgHr?: number | null;
    residenceTimeMinutes?: number | null;
    dieselOperationLiters?: number | null;
    dieselGensetLiters?: number | null;
    preprocessingFuelLiters?: number | null;
    electricityKwh?: number | null;
    biocharOutputKg?: number | null;
    biocharStorageLocationId?: string | null;
    feedstockStorageLocationId?: string | null;
    plcDataFileUrl?: string | null;
  }
): Promise<ProductionRunWithRelations> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.code, data.code));

  if (existing) {
    throw new Error("A production run with this code already exists");
  }

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, data.facilityId));

  if (!facility) {
    throw new Error("Facility not found");
  }

  // Verify reactor exists and belongs to facility
  const [reactor] = await db
    .select({ id: reactors.id, facilityId: reactors.facilityId })
    .from(reactors)
    .where(eq(reactors.id, data.reactorId));

  if (!reactor) {
    throw new Error("Reactor not found");
  }

  if (reactor.facilityId !== data.facilityId) {
    throw new Error("Reactor does not belong to the selected facility");
  }

  // Create production run
  const [run] = await db
    .insert(productionRuns)
    .values({
      code: data.code,
      facilityId: data.facilityId,
      date: data.date.toISOString().split('T')[0],
      status: data.status ?? "draft",
      startTime: data.startTime,
      endTime: data.endTime,
      reactorId: data.reactorId,
      operatorId: data.operatorId ?? null,
      feedingRateKgHr: data.feedingRateKgHr ?? null,
      residenceTimeMinutes: data.residenceTimeMinutes ?? null,
      dieselOperationLiters: data.dieselOperationLiters ?? null,
      dieselGensetLiters: data.dieselGensetLiters ?? null,
      preprocessingFuelLiters: data.preprocessingFuelLiters ?? null,
      electricityKwh: data.electricityKwh ?? null,
      biocharOutputKg: data.biocharOutputKg ?? null,
      biocharStorageLocationId: data.biocharStorageLocationId ?? null,
      feedstockStorageLocationId: data.feedstockStorageLocationId ?? null,
      plcDataFileUrl: data.plcDataFileUrl ?? null,
    })
    .returning();

  // Create feedstock relationships
  if (data.feedstocks.length > 0) {
    await db.insert(productionRunFeedstocks).values(
      data.feedstocks.map((f) => ({
        productionRunId: run.id,
        feedstockId: f.feedstockId,
        massUsedKg: f.massUsedKg,
      }))
    );
  }

  return getProductionRunById(userId, run.id);
}

// ============================================
// Production Run Update Operations
// ============================================

/**
 * Update an existing production run
 */
export async function updateProductionRun(
  userId: string,
  productionRunId: string,
  data: {
    code?: string;
    facilityId?: string;
    date?: Date;
    reactorId?: string;
    status?: "draft" | "running" | "complete" | "void";
    startTime?: Date;
    endTime?: Date;
    operatorId?: string | null;
    feedstocks?: ProductionRunFeedstockData[];
    feedingRateKgHr?: number | null;
    residenceTimeMinutes?: number | null;
    dieselOperationLiters?: number | null;
    dieselGensetLiters?: number | null;
    preprocessingFuelLiters?: number | null;
    electricityKwh?: number | null;
    biocharOutputKg?: number | null;
    biocharStorageLocationId?: string | null;
    feedstockStorageLocationId?: string | null;
    plcDataFileUrl?: string | null;
  }
): Promise<ProductionRunWithRelations> {
  requireAuth(userId);

  // Verify run exists
  const [existing] = await db
    .select()
    .from(productionRuns)
    .where(eq(productionRuns.id, productionRunId));

  if (!existing) {
    throw new Error("Production run not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: productionRuns.id })
      .from(productionRuns)
      .where(eq(productionRuns.code, data.code));

    if (duplicate) {
      throw new Error("A production run with this code already exists");
    }
  }

  // If reactor is being changed, verify it belongs to the facility
  if (data.reactorId && data.reactorId !== existing.reactorId) {
    const targetFacilityId = data.facilityId ?? existing.facilityId;
    const [reactor] = await db
      .select({ facilityId: reactors.facilityId })
      .from(reactors)
      .where(eq(reactors.id, data.reactorId));

    if (!reactor) {
      throw new Error("Reactor not found");
    }

    if (reactor.facilityId !== targetFacilityId) {
      throw new Error("Reactor does not belong to the selected facility");
    }
  }

  // Update production run
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.code !== undefined) updateData.code = data.code;
  if (data.facilityId !== undefined) updateData.facilityId = data.facilityId;
  if (data.date !== undefined) updateData.date = data.date.toISOString().split('T')[0];
  if (data.reactorId !== undefined) updateData.reactorId = data.reactorId;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.startTime !== undefined) updateData.startTime = data.startTime;
  if (data.endTime !== undefined) updateData.endTime = data.endTime;
  if (data.operatorId !== undefined) updateData.operatorId = data.operatorId;
  if (data.feedingRateKgHr !== undefined) updateData.feedingRateKgHr = data.feedingRateKgHr;
  if (data.residenceTimeMinutes !== undefined) updateData.residenceTimeMinutes = data.residenceTimeMinutes;
  if (data.dieselOperationLiters !== undefined) updateData.dieselOperationLiters = data.dieselOperationLiters;
  if (data.dieselGensetLiters !== undefined) updateData.dieselGensetLiters = data.dieselGensetLiters;
  if (data.preprocessingFuelLiters !== undefined) updateData.preprocessingFuelLiters = data.preprocessingFuelLiters;
  if (data.electricityKwh !== undefined) updateData.electricityKwh = data.electricityKwh;
  if (data.biocharOutputKg !== undefined) updateData.biocharOutputKg = data.biocharOutputKg;
  if (data.biocharStorageLocationId !== undefined) updateData.biocharStorageLocationId = data.biocharStorageLocationId;
  if (data.feedstockStorageLocationId !== undefined) updateData.feedstockStorageLocationId = data.feedstockStorageLocationId;
  if (data.plcDataFileUrl !== undefined) updateData.plcDataFileUrl = data.plcDataFileUrl;

  await db
    .update(productionRuns)
    .set(updateData)
    .where(eq(productionRuns.id, productionRunId));

  // Update feedstock relationships if provided
  if (data.feedstocks !== undefined) {
    // Delete existing feedstock relationships
    await db
      .delete(productionRunFeedstocks)
      .where(eq(productionRunFeedstocks.productionRunId, productionRunId));

    // Create new feedstock relationships
    if (data.feedstocks.length > 0) {
      await db.insert(productionRunFeedstocks).values(
        data.feedstocks.map((f) => ({
          productionRunId,
          feedstockId: f.feedstockId,
          massUsedKg: f.massUsedKg,
        }))
      );
    }
  }

  return getProductionRunById(userId, productionRunId);
}

// ============================================
// Production Run Delete Operations
// ============================================

/**
 * Delete a production run
 * Will fail if run has associated samples or credit batches
 */
export async function deleteProductionRun(
  userId: string,
  productionRunId: string
): Promise<void> {
  requireAuth(userId);

  // Verify run exists
  const [existing] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, productionRunId));

  if (!existing) {
    throw new Error("Production run not found");
  }

  // Delete feedstock relationships first
  await db
    .delete(productionRunFeedstocks)
    .where(eq(productionRunFeedstocks.productionRunId, productionRunId));

  // Delete readings
  await db
    .delete(productionRunReadings)
    .where(eq(productionRunReadings.productionRunId, productionRunId));

  // Note: Foreign key constraints will prevent deletion if there are
  // dependent samples or credit batches. The error will be caught by the server action.

  await db.delete(productionRuns).where(eq(productionRuns.id, productionRunId));
}

// ============================================
// Production Run Reading Operations
// ============================================

/**
 * Add a reading to a production run
 */
export async function addProductionRunReading(
  userId: string,
  data: {
    productionRunId: string;
    timestamp: Date;
    temperatureC?: number | null;
    pressureBar?: number | null;
    gasFlowRate?: number | null;
  }
): Promise<ProductionRunReadingRecord> {
  requireAuth(userId);

  // Verify run exists
  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, data.productionRunId));

  if (!run) {
    throw new Error("Production run not found");
  }

  const [reading] = await db
    .insert(productionRunReadings)
    .values({
      productionRunId: data.productionRunId,
      timestamp: data.timestamp,
      temperatureC: data.temperatureC ?? null,
      pressureBar: data.pressureBar ?? null,
      gasFlowRate: data.gasFlowRate ?? null,
    })
    .returning();

  return reading;
}

// ============================================
// Utility Operations
// ============================================

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
