/**
 * Feedstocks Data Access Layer
 * CRUD operations for feedstocks with auth guards, pagination, and filtering
 */

import { and, asc, count, desc, eq, ilike, or, sql, SQL, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  feedstocks,
  feedstockDeliveries,
  feedstockTypes,
  facilities,
  storageLocations,
  productionRunFeedstocks,
} from "@/db/schema";
import type { FeedstockFilterData } from "@/schemas/feedstocks";
import { requireAuth } from "./utils";

// ============================================
// Types
// ============================================

export interface FeedstockWithRelations {
  id: string;
  code: string;
  facilityId: string;
  status: "missing_data" | "complete";
  feedstockDeliveryId: string;
  feedstockTypeId: string;
  massDryKg: number;
  massWetKg: number | null;
  moistureContentPercent: number | null;
  feedstockSourceRegion: string | null;
  storageLocationId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  facilityName: string | null;
  feedstockDeliveryCode: string | null;
  feedstockTypeName: string | null;
  feedstockTypeCategory: string | null;
  storageLocationName: string | null;
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

// ============================================
// Feedstock Read Operations
// ============================================

const feedstockSelectFields = {
  id: feedstocks.id,
  code: feedstocks.code,
  facilityId: feedstocks.facilityId,
  status: feedstocks.status,
  feedstockDeliveryId: feedstocks.feedstockDeliveryId,
  feedstockTypeId: feedstocks.feedstockTypeId,
  massDryKg: feedstocks.massDryKg,
  massWetKg: feedstocks.massWetKg,
  moistureContentPercent: feedstocks.moistureContentPercent,
  feedstockSourceRegion: feedstocks.feedstockSourceRegion,
  storageLocationId: feedstocks.storageLocationId,
  notes: feedstocks.notes,
  createdAt: feedstocks.createdAt,
  updatedAt: feedstocks.updatedAt,
  facilityName: facilities.name,
  feedstockDeliveryCode: feedstockDeliveries.code,
  feedstockTypeName: feedstockTypes.name,
  feedstockTypeCategory: feedstockTypes.category,
  storageLocationName: storageLocations.name,
} as const;

function feedstockBaseQuery() {
  return db
    .select(feedstockSelectFields)
    .from(feedstocks)
    .leftJoin(facilities, eq(feedstocks.facilityId, facilities.id))
    .leftJoin(feedstockDeliveries, eq(feedstocks.feedstockDeliveryId, feedstockDeliveries.id))
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .leftJoin(storageLocations, eq(feedstocks.storageLocationId, storageLocations.id));
}

export async function getFeedstocks(
  userId: string,
  filters?: Partial<FeedstockFilterData>
): Promise<PaginatedFeedstocks> {
  requireAuth(userId);

  const {
    search,
    facilityId,
    feedstockDeliveryId,
    feedstockTypeId,
    status,
    page = 1,
    pageSize = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = filters ?? {};

  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(feedstocks.code, searchPattern),
        ilike(feedstockDeliveries.code, searchPattern),
        ilike(feedstockTypes.name, searchPattern)
      )!
    );
  }

  if (facilityId) {
    conditions.push(eq(feedstocks.facilityId, facilityId));
  }

  if (feedstockDeliveryId) {
    conditions.push(eq(feedstocks.feedstockDeliveryId, feedstockDeliveryId));
  }

  if (feedstockTypeId) {
    conditions.push(eq(feedstocks.feedstockTypeId, feedstockTypeId));
  }

  if (status) {
    conditions.push(eq(feedstocks.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const sortColumn = {
    code: feedstocks.code,
    massDryKg: feedstocks.massDryKg,
    createdAt: feedstocks.createdAt,
    updatedAt: feedstocks.updatedAt,
  }[sortBy] ?? feedstocks.createdAt;

  const orderFn = sortOrder === "asc" ? asc : desc;

  // Count total
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(feedstocks)
    .leftJoin(feedstockDeliveries, eq(feedstocks.feedstockDeliveryId, feedstockDeliveries.id))
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
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

  const [feedstock] = await feedstockBaseQuery().where(
    eq(feedstocks.id, feedstockId)
  );

  if (!feedstock) {
    throw new Error("Feedstock not found");
  }

  return feedstock;
}

export async function getFeedstockStats(
  userId: string,
  facilityId?: string
): Promise<FeedstockStats> {
  requireAuth(userId);

  const conditions: SQL[] = [];
  if (facilityId) {
    conditions.push(eq(feedstocks.facilityId, facilityId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalFeedstocks: count(),
      totalDryMassKg: sum(feedstocks.massDryKg),
      avgMoisturePercent: sql<number>`avg(${feedstocks.moistureContentPercent})`,
    })
    .from(feedstocks)
    .where(whereClause);

  const [completeCounts] = await db
    .select({ count: count() })
    .from(feedstocks)
    .where(
      whereClause
        ? and(whereClause, eq(feedstocks.status, "complete"))
        : eq(feedstocks.status, "complete")
    );

  const [missingDataCounts] = await db
    .select({ count: count() })
    .from(feedstocks)
    .where(
      whereClause
        ? and(whereClause, eq(feedstocks.status, "missing_data"))
        : eq(feedstocks.status, "missing_data")
    );

  return {
    totalFeedstocks: Number(stats.totalFeedstocks),
    totalDryMassKg: Number(stats.totalDryMassKg) || 0,
    avgMoisturePercent: stats.avgMoisturePercent
      ? Number(stats.avgMoisturePercent)
      : null,
    completeFeedstocks: Number(completeCounts.count),
    missingDataFeedstocks: Number(missingDataCounts.count),
  };
}

export async function getFeedstockOptions(
  userId: string
): Promise<
  Array<{ id: string; code: string; massDryKg: number; feedstockTypeName: string | null }>
> {
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
// Feedstock Create Operations
// ============================================

export async function createFeedstock(
  userId: string,
  data: {
    code: string;
    facilityId: string;
    feedstockDeliveryId: string;
    feedstockTypeId: string;
    massDryKg: number;
    massWetKg?: number | null;
    moistureContentPercent?: number | null;
    storageLocationId?: string | null;
    feedstockSourceRegion?: string | null;
    notes?: string | null;
  }
): Promise<FeedstockWithRelations> {
  requireAuth(userId);

  const [existing] = await db
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(eq(feedstocks.code, data.code));

  if (existing) {
    throw new Error("A feedstock with this code already exists");
  }

  const status = determineFeedstockStatus(data);

  try {
    const [feedstock] = await db
      .insert(feedstocks)
      .values({
        code: data.code,
        facilityId: data.facilityId,
        status,
        feedstockDeliveryId: data.feedstockDeliveryId,
        feedstockTypeId: data.feedstockTypeId,
        massDryKg: data.massDryKg,
        massWetKg: data.massWetKg ?? null,
        moistureContentPercent: data.moistureContentPercent ?? null,
        storageLocationId: data.storageLocationId ?? null,
        feedstockSourceRegion: data.feedstockSourceRegion || null,
        notes: data.notes || null,
      })
      .returning();

    return getFeedstockById(userId, feedstock.id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new Error("A feedstock with this code already exists");
    }
    throw error;
  }
}

// ============================================
// Feedstock Update Operations
// ============================================

export async function updateFeedstock(
  userId: string,
  feedstockId: string,
  data: {
    feedstockDeliveryId?: string;
    feedstockTypeId?: string;
    facilityId?: string;
    massDryKg?: number;
    massWetKg?: number | null;
    moistureContentPercent?: number | null;
    storageLocationId?: string | null;
    feedstockSourceRegion?: string | null;
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
// Feedstock Delete Operations
// ============================================

export async function deleteFeedstock(
  userId: string,
  feedstockId: string
): Promise<void> {
  requireAuth(userId);

  const [existing] = await db
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(eq(feedstocks.id, feedstockId));

  if (!existing) {
    throw new Error("Feedstock not found");
  }

  // Check for associated production run feedstocks
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
  excludeFeedstockId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(feedstocks.code, code)];

  if (excludeFeedstockId) {
    conditions.push(sql`${feedstocks.id} != ${excludeFeedstockId}`);
  }

  const [existing] = await db
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(and(...conditions));

  return !existing;
}

// ============================================
// Helper Functions
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
