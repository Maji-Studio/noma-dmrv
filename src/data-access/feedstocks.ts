/**
 * Feedstock Data Access Layer
 * Unified CRUD for the combined delivery + bin allocation workflow.
 * Each feedstock record contains both delivery info and bin allocation.
 * Split deliveries (one truck → multiple bins) share a deliveryGroupId.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  feedstocks,
  feedstockTypes,
  facilities,
  storageLocations,
  suppliers,
  vehicles,
  productionRunFeedstocks,
} from "@/db/schema";
import type { FeedstockFilterData } from "@/schemas/feedstocks";
import { requireAuth } from "./utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";

// ============================================
// Types
// ============================================

export interface FeedstockWithRelations {
  id: string;
  code: string;
  facilityId: string;
  status: "missing_data" | "complete";
  // Delivery fields
  deliveryDate: Date | null;
  supplierId: string | null;
  vehicleId: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  deliveryGroupId: string | null;
  overrideJustification: string | null;
  // Material fields
  feedstockTypeId: string;
  massDryKg: number;
  massWetKg: number | null;
  moistureContentPercent: number | null;
  storageLocationId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined relations
  facilityName: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  vehiclePlateNumber: string | null;
  feedstockTypeName: string | null;
  feedstockTypeCategory: string | null;
  storageLocationName: string | null;
  storageLocationCode: string | null;
}

export interface PaginatedFeedstocks {
  items: FeedstockWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FeedstockStats {
  totalFeedstocks: number;
  totalDryMassKg: number;
  avgMoisturePercent: number | null;
  completeFeedstocks: number;
  missingDataFeedstocks: number;
}

export interface CreateFeedstockAllocation {
  storageLocationId: string;
  allocatedWetMassKg: number;
}

export interface CreateFeedstockInput {
  facilityId: string;
  deliveryDate: Date;
  supplierId: string;
  vehicleId?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  feedstockTypeId: string;
  totalWetMassKg: number;
  moisturePercent: number;
  allocations: CreateFeedstockAllocation[];
  overrideJustification?: string | null;
  notes?: string | null;
}

export interface CreateFeedstockResult {
  feedstocks: FeedstockWithRelations[];
  warning: string | null;
}

// ============================================
// Select fields
// ============================================

const feedstockSelectFields = {
  id: feedstocks.id,
  code: feedstocks.code,
  facilityId: feedstocks.facilityId,
  status: feedstocks.status,
  deliveryDate: feedstocks.deliveryDate,
  supplierId: feedstocks.supplierId,
  vehicleId: feedstocks.vehicleId,
  gpsLatitude: feedstocks.gpsLatitude,
  gpsLongitude: feedstocks.gpsLongitude,
  deliveryGroupId: feedstocks.deliveryGroupId,
  overrideJustification: feedstocks.overrideJustification,
  feedstockTypeId: feedstocks.feedstockTypeId,
  massDryKg: feedstocks.massDryKg,
  massWetKg: feedstocks.massWetKg,
  moistureContentPercent: feedstocks.moistureContentPercent,
  storageLocationId: feedstocks.storageLocationId,
  notes: feedstocks.notes,
  createdAt: feedstocks.createdAt,
  updatedAt: feedstocks.updatedAt,
  // Relations
  facilityName: facilities.name,
  supplierName: suppliers.name,
  supplierCode: suppliers.code,
  vehiclePlateNumber: vehicles.name,
  feedstockTypeName: feedstockTypes.name,
  feedstockTypeCategory: feedstockTypes.category,
  storageLocationName: storageLocations.name,
  storageLocationCode: storageLocations.code,
} as const;

function feedstockBaseQuery() {
  return db
    .select(feedstockSelectFields)
    .from(feedstocks)
    .leftJoin(facilities, eq(feedstocks.facilityId, facilities.id))
    .leftJoin(suppliers, eq(feedstocks.supplierId, suppliers.id))
    .leftJoin(vehicles, eq(feedstocks.vehicleId, vehicles.id))
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .leftJoin(storageLocations, eq(feedstocks.storageLocationId, storageLocations.id));
}

// ============================================
// Read Operations
// ============================================

export async function getFeedstocks(
  userId: string,
  filters?: Partial<FeedstockFilterData>
): Promise<PaginatedFeedstocks> {
  requireAuth(userId);

  const {
    search,
    facilityId,
    supplierId,
    feedstockTypeId,
    status,
    storageLocationId,
    startDate,
    endDate,
    page = 1,
    pageSize = 20,
    sortBy = "deliveryDate",
    sortOrder = "desc",
  } = filters ?? {};

  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(feedstocks.code, searchPattern),
        ilike(suppliers.name, searchPattern),
        ilike(suppliers.code, searchPattern),
        ilike(feedstockTypes.name, searchPattern),
        ilike(storageLocations.name, searchPattern)
      )!
    );
  }

  if (facilityId) conditions.push(eq(feedstocks.facilityId, facilityId));
  if (supplierId) conditions.push(eq(feedstocks.supplierId, supplierId));
  if (feedstockTypeId) conditions.push(eq(feedstocks.feedstockTypeId, feedstockTypeId));
  if (status) conditions.push(eq(feedstocks.status, status));
  if (storageLocationId) conditions.push(eq(feedstocks.storageLocationId, storageLocationId));
  if (startDate) {
    const startOfDay = new Date(startDate);
    startOfDay.setHours(0, 0, 0, 0);
    conditions.push(gte(feedstocks.deliveryDate, startOfDay));
  }
  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(lte(feedstocks.deliveryDate, endOfDay));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const sortColumn = {
    code: feedstocks.code,
    deliveryDate: feedstocks.deliveryDate,
    massDryKg: feedstocks.massDryKg,
    massWetKg: feedstocks.massWetKg,
    createdAt: feedstocks.createdAt,
    updatedAt: feedstocks.updatedAt,
  }[sortBy] ?? feedstocks.deliveryDate;

  const orderFn = sortOrder === "asc" ? asc : desc;

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(feedstocks)
    .leftJoin(suppliers, eq(feedstocks.supplierId, suppliers.id))
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .leftJoin(storageLocations, eq(feedstocks.storageLocationId, storageLocations.id))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  const items = await feedstockBaseQuery()
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  return { items, total, page, pageSize, totalPages };
}

export async function getFeedstockById(
  userId: string,
  feedstockId: string
): Promise<FeedstockWithRelations> {
  requireAuth(userId);

  const [item] = await feedstockBaseQuery().where(eq(feedstocks.id, feedstockId));

  if (!item) {
    throw new Error("Feedstock not found");
  }

  return item;
}

export async function getFeedstockStats(
  userId: string,
  facilityId?: string
): Promise<FeedstockStats> {
  requireAuth(userId);

  const conditions: SQL[] = [];
  if (facilityId) conditions.push(eq(feedstocks.facilityId, facilityId));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalFeedstocks: count(),
      totalDryMassKg: sql<number>`coalesce(sum(${feedstocks.massDryKg}), 0)`,
      avgMoisturePercent: sql<number | null>`case when sum(case when ${feedstocks.moistureContentPercent} is not null then ${feedstocks.massWetKg} end) > 0 then sum(case when ${feedstocks.moistureContentPercent} is not null then ${feedstocks.moistureContentPercent} * ${feedstocks.massWetKg} end) / sum(case when ${feedstocks.moistureContentPercent} is not null then ${feedstocks.massWetKg} end) else null end`,
      completeFeedstocks: sql<number>`count(*) filter (where ${feedstocks.status} = 'complete')`,
      missingDataFeedstocks: sql<number>`count(*) filter (where ${feedstocks.status} = 'missing_data')`,
    })
    .from(feedstocks)
    .where(whereClause);

  return {
    totalFeedstocks: Number(stats.totalFeedstocks),
    totalDryMassKg: Number(stats.totalDryMassKg),
    avgMoisturePercent: stats.avgMoisturePercent != null ? Number(stats.avgMoisturePercent) : null,
    completeFeedstocks: Number(stats.completeFeedstocks),
    missingDataFeedstocks: Number(stats.missingDataFeedstocks),
  };
}

// ============================================
// Create Operations
// ============================================

export async function createFeedstock(
  userId: string,
  data: CreateFeedstockInput,
  codesFn: (count: number) => Promise<string[]>
): Promise<CreateFeedstockResult> {
  requireAuth(userId);

  const allocatedTotalWetKg = data.allocations.reduce((sum, a) => sum + a.allocatedWetMassKg, 0);
  const deliveryGroupId = data.allocations.length > 1 ? crypto.randomUUID() : null;

  // Look up feedstock type category for bin-type enforcement
  const [feedstockType] = await db
    .select({ category: feedstockTypes.category })
    .from(feedstockTypes)
    .where(eq(feedstockTypes.id, data.feedstockTypeId));

  if (!feedstockType) {
    throw new Error("Feedstock type not found");
  }

  const isIngredient = feedstockType.category === "ingredient";
  const expectedBinType = isIngredient ? "ingredient_bin" : "feedstock_bin";

  // Batch-validate bin type compatibility for all allocations
  const binIds = data.allocations.map((a) => a.storageLocationId);
  const bins = await db
    .select({
      id: storageLocations.id,
      type: storageLocations.type,
      feedstockTypeId: storageLocations.feedstockTypeId,
      facilityId: storageLocations.facilityId,
    })
    .from(storageLocations)
    .where(inArray(storageLocations.id, binIds));

  const binMap = new Map(bins.map((b) => [b.id, b]));
  for (const allocation of data.allocations) {
    const bin = binMap.get(allocation.storageLocationId);
    if (!bin) {
      throw new Error(`Storage bin not found: ${allocation.storageLocationId}`);
    }
    if (bin.facilityId !== data.facilityId) {
      throw new Error(`Storage bin ${bin.id} does not belong to the selected facility`);
    }
    if (bin.type !== expectedBinType) {
      const label = isIngredient ? "an ingredient bin" : "a feedstock bin";
      throw new Error(
        `${isIngredient ? "Ingredient" : "Feedstock"} materials must be allocated to ${label}, not a ${bin.type.replace("_", " ")}.`
      );
    }
    if (bin.feedstockTypeId && bin.feedstockTypeId !== data.feedstockTypeId) {
      throw new Error(
        `Storage bin already holds a different feedstock type. Each bin can only hold one type.`
      );
    }
  }

  const codes = await codesFn(data.allocations.length);

  const createdFeedstocks = await db.transaction(async (tx) => {
    const results: string[] = [];

    for (let i = 0; i < data.allocations.length; i++) {
      const allocation = data.allocations[i];
      const allocatedDryMassKg = deriveMassDryKg(allocation.allocatedWetMassKg, data.moisturePercent);

      const status = determineFeedstockStatus({
        feedstockTypeId: data.feedstockTypeId,
        massDryKg: allocatedDryMassKg,
      });

      const [feedstock] = await tx
        .insert(feedstocks)
        .values({
          code: codes[i],
          facilityId: data.facilityId,
          status,
          // Delivery fields
          deliveryDate: data.deliveryDate,
          supplierId: data.supplierId,
          vehicleId: data.vehicleId ?? null,
          gpsLatitude: data.gpsLatitude ?? null,
          gpsLongitude: data.gpsLongitude ?? null,
          deliveryGroupId,
          overrideJustification: data.overrideJustification || null,
          // Material fields
          feedstockTypeId: data.feedstockTypeId,
          massDryKg: allocatedDryMassKg,
          massWetKg: allocation.allocatedWetMassKg,
          moistureContentPercent: data.moisturePercent,
          storageLocationId: allocation.storageLocationId,
          notes: data.notes || null,
        })
        .returning({ id: feedstocks.id });

      results.push(feedstock.id);

      // Lock feedstock type on bin (first-use lock)
      await tx
        .update(storageLocations)
        .set({ feedstockTypeId: data.feedstockTypeId })
        .where(
          and(
            eq(storageLocations.id, allocation.storageLocationId),
            sql`${storageLocations.feedstockTypeId} is null`
          )
        );
    }

    return results;
  });

  // Fetch the created records with relations in one query
  const items = await feedstockBaseQuery()
    .where(inArray(feedstocks.id, createdFeedstocks));

  // Generate warning if allocated wet mass > total delivery wet mass
  let warning: string | null = null;
  if (allocatedTotalWetKg > data.totalWetMassKg) {
    warning = `Allocated wet mass (${allocatedTotalWetKg.toFixed(1)} kg) exceeds total delivery wet mass (${data.totalWetMassKg.toFixed(1)} kg).`;
  }

  return { feedstocks: items, warning };
}

// ============================================
// Update Operations
// ============================================

export async function updateFeedstock(
  userId: string,
  feedstockId: string,
  data: {
    facilityId?: string;
    deliveryDate?: Date;
    supplierId?: string;
    vehicleId?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    feedstockTypeId?: string;
    massDryKg?: number;
    massWetKg?: number | null;
    moistureContentPercent?: number | null;
    storageLocationId?: string | null;
    overrideJustification?: string | null;
    notes?: string | null;
  }
): Promise<FeedstockWithRelations> {
  requireAuth(userId);

  const [existing] = await db
    .select()
    .from(feedstocks)
    .where(eq(feedstocks.id, feedstockId));

  if (!existing) {
    throw new Error("Feedstock not found");
  }

  // Validate storage bin compatibility if changing storage location or feedstock type
  if (data.storageLocationId || data.feedstockTypeId) {
    const binId = data.storageLocationId ?? existing.storageLocationId;
    const typeId = data.feedstockTypeId ?? existing.feedstockTypeId;
    const facId = data.facilityId ?? existing.facilityId;

    // Look up feedstock type category (needed for bin-type enforcement)
    const [ft] = await db
      .select({ category: feedstockTypes.category })
      .from(feedstockTypes)
      .where(eq(feedstockTypes.id, typeId));

    if (!ft) {
      throw new Error("Feedstock type not found");
    }

    const isIngredient = ft.category === "ingredient";
    const expectedBinType = isIngredient ? "ingredient_bin" : "feedstock_bin";

    if (binId) {
      const [bin] = await db
        .select({
          type: storageLocations.type,
          feedstockTypeId: storageLocations.feedstockTypeId,
          facilityId: storageLocations.facilityId,
        })
        .from(storageLocations)
        .where(eq(storageLocations.id, binId));

      if (!bin) {
        throw new Error(`Storage bin not found: ${binId}`);
      }
      if (bin.facilityId !== facId) {
        throw new Error(`Storage bin ${binId} does not belong to the selected facility`);
      }

      if (bin.type !== expectedBinType) {
        const label = isIngredient ? "an ingredient bin" : "a feedstock bin";
        throw new Error(
          `${isIngredient ? "Ingredient" : "Feedstock"} materials must be allocated to ${label}.`
        );
      }
      if (bin.feedstockTypeId && bin.feedstockTypeId !== typeId) {
        throw new Error(
          "Storage bin already holds a different feedstock type. Each bin can only hold one type."
        );
      }
    }
  }

  const mergedData = { ...existing, ...data };
  const status = determineFeedstockStatus(mergedData);

  await db
    .update(feedstocks)
    .set({
      ...data,
      status,
      updatedAt: new Date(),
    })
    .where(eq(feedstocks.id, feedstockId));

  return getFeedstockById(userId, feedstockId);
}

// ============================================
// Delete Operations
// ============================================

export async function deleteFeedstock(
  userId: string,
  feedstockId: string
): Promise<void> {
  requireAuth(userId);

  // Block deletion if used in production runs
  const [usageCount] = await db
    .select({ count: count() })
    .from(productionRunFeedstocks)
    .where(eq(productionRunFeedstocks.feedstockId, feedstockId));

  if (Number(usageCount.count) > 0) {
    throw new Error(
      "Cannot delete feedstock that is used in production runs. Remove production run associations first."
    );
  }

  await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
}

// ============================================
// Utility Operations
// ============================================

export async function isFeedstockCodeAvailable(
  userId: string,
  code: string,
  excludeId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(feedstocks.code, code)];
  if (excludeId) {
    conditions.push(sql`${feedstocks.id} != ${excludeId}`);
  }

  const [existing] = await db
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get feedstock options for dropdowns (e.g., production run feedstock selection)
 */
export async function getFeedstockOptions(
  userId: string
): Promise<Array<{ id: string; code: string; massDryKg: number; feedstockTypeName: string | null }>> {
  requireAuth(userId);

  return db
    .select({
      id: feedstocks.id,
      code: feedstocks.code,
      massDryKg: feedstocks.massDryKg,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(feedstocks)
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .orderBy(desc(feedstocks.createdAt));
}

// ============================================
// Helpers
// ============================================

function determineFeedstockStatus(data: {
  feedstockTypeId?: string | null;
  massDryKg?: number | null;
}): "missing_data" | "complete" {
  if (
    data.feedstockTypeId &&
    data.massDryKg !== null &&
    data.massDryKg !== undefined &&
    data.massDryKg > 0
  ) {
    return "complete";
  }
  return "missing_data";
}
