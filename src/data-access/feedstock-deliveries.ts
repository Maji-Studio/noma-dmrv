/**
 * Feedstock Deliveries Data Access Layer
 * CRUD operations for feedstock deliveries with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, gte, ilike, lte, or, sql, SQL, count, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  feedstockDeliveries,
  feedstockTypes,
  feedstocks,
  suppliers,
  drivers,
  vehicles,
  facilities,
} from "@/db/schema";
import type { FeedstockDeliveryFilterData } from "@/schemas/feedstock-deliveries";

// ============================================
// Types
// ============================================

export interface FeedstockDeliveryWithRelations {
  id: string;
  code: string;
  facilityId: string;
  status: "missing_data" | "complete";
  deliveryDate: Date;
  supplierId: string;
  driverId: string | null;
  vehicleId: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  feedstockTypeId: string | null;
  weightKg: number | null;
  moisturePercent: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  facilityName: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  driverName: string | null;
  vehicleName: string | null;
  feedstockTypeName: string | null;
  feedstockTypeCategory: string | null;
}

export interface PaginatedFeedstockDeliveries {
  items: FeedstockDeliveryWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FeedstockDeliveryStats {
  totalDeliveries: number;
  totalWeightKg: number;
  avgMoisturePercent: number | null;
  completeDeliveries: number;
  missingDataDeliveries: number;
}

// ============================================
// Auth Guards
// ============================================

/**
 * Require user to be authenticated
 * Throws error if userId is not provided
 */
function requireAuth(userId: string): void {
  if (!userId) {
    throw new Error("Unauthorized");
  }
}

// ============================================
// Feedstock Delivery Read Operations
// ============================================

/**
 * Get all feedstock deliveries with pagination and filtering
 * Supports search, facility/supplier/feedstock type filter, date range, sorting, and pagination
 */
export async function getFeedstockDeliveries(
  userId: string,
  filters?: Partial<FeedstockDeliveryFilterData>
): Promise<PaginatedFeedstockDeliveries> {
  requireAuth(userId);

  const {
    search,
    facilityId,
    supplierId,
    feedstockTypeId,
    status,
    startDate,
    endDate,
    page = 1,
    pageSize = 20,
    sortBy = "deliveryDate",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(feedstockDeliveries.code, searchPattern),
        ilike(suppliers.name, searchPattern),
        ilike(suppliers.code, searchPattern)
      )!
    );
  }

  if (facilityId) {
    conditions.push(eq(feedstockDeliveries.facilityId, facilityId));
  }

  if (supplierId) {
    conditions.push(eq(feedstockDeliveries.supplierId, supplierId));
  }

  if (feedstockTypeId) {
    conditions.push(eq(feedstockDeliveries.feedstockTypeId, feedstockTypeId));
  }

  if (status) {
    conditions.push(eq(feedstockDeliveries.status, status));
  }

  if (startDate) {
    conditions.push(gte(feedstockDeliveries.deliveryDate, startDate));
  }

  if (endDate) {
    conditions.push(lte(feedstockDeliveries.deliveryDate, endDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: feedstockDeliveries.code,
    deliveryDate: feedstockDeliveries.deliveryDate,
    weightKg: feedstockDeliveries.weightKg,
    createdAt: feedstockDeliveries.createdAt,
    updatedAt: feedstockDeliveries.updatedAt,
  }[sortBy] ?? feedstockDeliveries.deliveryDate;

  const orderFn = sortOrder === "asc" ? asc : desc;

  // Count total for pagination
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(feedstockDeliveries)
    .leftJoin(suppliers, eq(feedstockDeliveries.supplierId, suppliers.id))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get feedstock deliveries with relations
  const deliveryList = await db
    .select({
      id: feedstockDeliveries.id,
      code: feedstockDeliveries.code,
      facilityId: feedstockDeliveries.facilityId,
      status: feedstockDeliveries.status,
      deliveryDate: feedstockDeliveries.deliveryDate,
      supplierId: feedstockDeliveries.supplierId,
      driverId: feedstockDeliveries.driverId,
      vehicleId: feedstockDeliveries.vehicleId,
      gpsLatitude: feedstockDeliveries.gpsLatitude,
      gpsLongitude: feedstockDeliveries.gpsLongitude,
      feedstockTypeId: feedstockDeliveries.feedstockTypeId,
      weightKg: feedstockDeliveries.weightKg,
      moisturePercent: feedstockDeliveries.moisturePercent,
      notes: feedstockDeliveries.notes,
      createdAt: feedstockDeliveries.createdAt,
      updatedAt: feedstockDeliveries.updatedAt,
      facilityName: facilities.name,
      supplierName: suppliers.name,
      supplierCode: suppliers.code,
      driverName: drivers.name,
      vehicleName: vehicles.name,
      feedstockTypeName: feedstockTypes.name,
      feedstockTypeCategory: feedstockTypes.category,
    })
    .from(feedstockDeliveries)
    .leftJoin(facilities, eq(feedstockDeliveries.facilityId, facilities.id))
    .leftJoin(suppliers, eq(feedstockDeliveries.supplierId, suppliers.id))
    .leftJoin(drivers, eq(feedstockDeliveries.driverId, drivers.id))
    .leftJoin(vehicles, eq(feedstockDeliveries.vehicleId, vehicles.id))
    .leftJoin(feedstockTypes, eq(feedstockDeliveries.feedstockTypeId, feedstockTypes.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  return {
    items: deliveryList,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single feedstock delivery by ID
 * Returns delivery data with relations
 */
export async function getFeedstockDeliveryById(
  userId: string,
  deliveryId: string
): Promise<FeedstockDeliveryWithRelations> {
  requireAuth(userId);

  const [delivery] = await db
    .select({
      id: feedstockDeliveries.id,
      code: feedstockDeliveries.code,
      facilityId: feedstockDeliveries.facilityId,
      status: feedstockDeliveries.status,
      deliveryDate: feedstockDeliveries.deliveryDate,
      supplierId: feedstockDeliveries.supplierId,
      driverId: feedstockDeliveries.driverId,
      vehicleId: feedstockDeliveries.vehicleId,
      gpsLatitude: feedstockDeliveries.gpsLatitude,
      gpsLongitude: feedstockDeliveries.gpsLongitude,
      feedstockTypeId: feedstockDeliveries.feedstockTypeId,
      weightKg: feedstockDeliveries.weightKg,
      moisturePercent: feedstockDeliveries.moisturePercent,
      notes: feedstockDeliveries.notes,
      createdAt: feedstockDeliveries.createdAt,
      updatedAt: feedstockDeliveries.updatedAt,
      facilityName: facilities.name,
      supplierName: suppliers.name,
      supplierCode: suppliers.code,
      driverName: drivers.name,
      vehicleName: vehicles.name,
      feedstockTypeName: feedstockTypes.name,
      feedstockTypeCategory: feedstockTypes.category,
    })
    .from(feedstockDeliveries)
    .leftJoin(facilities, eq(feedstockDeliveries.facilityId, facilities.id))
    .leftJoin(suppliers, eq(feedstockDeliveries.supplierId, suppliers.id))
    .leftJoin(drivers, eq(feedstockDeliveries.driverId, drivers.id))
    .leftJoin(vehicles, eq(feedstockDeliveries.vehicleId, vehicles.id))
    .leftJoin(feedstockTypes, eq(feedstockDeliveries.feedstockTypeId, feedstockTypes.id))
    .where(eq(feedstockDeliveries.id, deliveryId));

  if (!delivery) {
    throw new Error("Feedstock delivery not found");
  }

  return delivery;
}

/**
 * Get feedstock delivery statistics
 * Returns aggregated stats for dashboard display
 */
export async function getFeedstockDeliveryStats(
  userId: string,
  facilityId?: string
): Promise<FeedstockDeliveryStats> {
  requireAuth(userId);

  const conditions: SQL[] = [];
  if (facilityId) {
    conditions.push(eq(feedstockDeliveries.facilityId, facilityId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [stats] = await db
    .select({
      totalDeliveries: count(),
      totalWeightKg: sum(feedstockDeliveries.weightKg),
      avgMoisturePercent: sql<number>`avg(${feedstockDeliveries.moisturePercent})`,
    })
    .from(feedstockDeliveries)
    .where(whereClause);

  // Get status counts separately
  const [completeCounts] = await db
    .select({ count: count() })
    .from(feedstockDeliveries)
    .where(
      whereClause
        ? and(whereClause, eq(feedstockDeliveries.status, "complete"))
        : eq(feedstockDeliveries.status, "complete")
    );

  const [missingDataCounts] = await db
    .select({ count: count() })
    .from(feedstockDeliveries)
    .where(
      whereClause
        ? and(whereClause, eq(feedstockDeliveries.status, "missing_data"))
        : eq(feedstockDeliveries.status, "missing_data")
    );

  return {
    totalDeliveries: Number(stats.totalDeliveries),
    totalWeightKg: Number(stats.totalWeightKg) || 0,
    avgMoisturePercent: stats.avgMoisturePercent ? Number(stats.avgMoisturePercent) : null,
    completeDeliveries: Number(completeCounts.count),
    missingDataDeliveries: Number(missingDataCounts.count),
  };
}

// ============================================
// Feedstock Delivery Create Operations
// ============================================

/**
 * Create a new feedstock delivery
 */
export async function createFeedstockDelivery(
  userId: string,
  data: {
    code: string;
    facilityId: string;
    deliveryDate: Date;
    supplierId: string;
    driverId?: string | null;
    vehicleId?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    feedstockTypeId?: string | null;
    weightKg?: number | null;
    moisturePercent?: number | null;
    notes?: string | null;
  }
): Promise<FeedstockDeliveryWithRelations> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: feedstockDeliveries.id })
    .from(feedstockDeliveries)
    .where(eq(feedstockDeliveries.code, data.code));

  if (existing) {
    throw new Error("A feedstock delivery with this code already exists");
  }

  // Determine status based on required fields
  const status = determineDeliveryStatus(data);

  try {
    const [delivery] = await db
      .insert(feedstockDeliveries)
      .values({
        code: data.code,
        facilityId: data.facilityId,
        status,
        deliveryDate: data.deliveryDate,
        supplierId: data.supplierId,
        driverId: data.driverId ?? null,
        vehicleId: data.vehicleId ?? null,
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
        feedstockTypeId: data.feedstockTypeId ?? null,
        weightKg: data.weightKg ?? null,
        moisturePercent: data.moisturePercent ?? null,
        notes: data.notes ?? null,
      })
      .returning();

    return getFeedstockDeliveryById(userId, delivery.id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new Error("A feedstock delivery with this code already exists");
    }
    throw error;
  }
}

// ============================================
// Feedstock Delivery Update Operations
// ============================================

/**
 * Update an existing feedstock delivery
 */
export async function updateFeedstockDelivery(
  userId: string,
  deliveryId: string,
  data: {
    code?: string;
    facilityId?: string;
    deliveryDate?: Date;
    supplierId?: string;
    driverId?: string | null;
    vehicleId?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    feedstockTypeId?: string | null;
    weightKg?: number | null;
    moisturePercent?: number | null;
    notes?: string | null;
  }
): Promise<FeedstockDeliveryWithRelations> {
  requireAuth(userId);

  // Verify delivery exists
  const [existing] = await db
    .select()
    .from(feedstockDeliveries)
    .where(eq(feedstockDeliveries.id, deliveryId));

  if (!existing) {
    throw new Error("Feedstock delivery not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: feedstockDeliveries.id })
      .from(feedstockDeliveries)
      .where(eq(feedstockDeliveries.code, data.code));

    if (duplicate) {
      throw new Error("A feedstock delivery with this code already exists");
    }
  }

  // Determine new status based on updated data
  const mergedData = { ...existing, ...data };
  const status = determineDeliveryStatus(mergedData);

  const [updated] = await db
    .update(feedstockDeliveries)
    .set({
      ...data,
      status,
      updatedAt: new Date(),
    })
    .where(eq(feedstockDeliveries.id, deliveryId))
    .returning();

  return getFeedstockDeliveryById(userId, updated.id);
}

// ============================================
// Feedstock Delivery Delete Operations
// ============================================

/**
 * Delete a feedstock delivery
 * Will fail if delivery has associated feedstocks
 */
export async function deleteFeedstockDelivery(
  userId: string,
  deliveryId: string
): Promise<void> {
  requireAuth(userId);

  // Verify delivery exists
  const [existing] = await db
    .select({ id: feedstockDeliveries.id })
    .from(feedstockDeliveries)
    .where(eq(feedstockDeliveries.id, deliveryId));

  if (!existing) {
    throw new Error("Feedstock delivery not found");
  }

  // Check for associated feedstocks
  const [feedstockCount] = await db
    .select({ count: count() })
    .from(feedstocks)
    .where(eq(feedstocks.feedstockDeliveryId, deliveryId));

  if (Number(feedstockCount.count) > 0) {
    throw new Error(
      "Cannot delete feedstock delivery with associated feedstocks. Remove feedstocks first."
    );
  }

  await db.delete(feedstockDeliveries).where(eq(feedstockDeliveries.id, deliveryId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a delivery code is available
 */
export async function isFeedstockDeliveryCodeAvailable(
  userId: string,
  code: string,
  excludeDeliveryId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(feedstockDeliveries.code, code)];

  if (excludeDeliveryId) {
    conditions.push(sql`${feedstockDeliveries.id} != ${excludeDeliveryId}`);
  }

  const [existing] = await db
    .select({ id: feedstockDeliveries.id })
    .from(feedstockDeliveries)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get feedstock delivery options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getFeedstockDeliveryOptions(
  userId: string
): Promise<Array<{ id: string; code: string; deliveryDate: Date; supplierName: string | null }>> {
  requireAuth(userId);

  return db
    .select({
      id: feedstockDeliveries.id,
      code: feedstockDeliveries.code,
      deliveryDate: feedstockDeliveries.deliveryDate,
      supplierName: suppliers.name,
    })
    .from(feedstockDeliveries)
    .leftJoin(suppliers, eq(feedstockDeliveries.supplierId, suppliers.id))
    .orderBy(desc(feedstockDeliveries.deliveryDate));
}

/**
 * Generate next delivery code
 * Returns the next available code in format FD-YYYY-XXX
 */
export async function generateNextDeliveryCode(userId: string): Promise<string> {
  requireAuth(userId);

  const year = new Date().getFullYear();
  const prefix = `FD-${year}-`;

  const [lastDelivery] = await db
    .select({ code: feedstockDeliveries.code })
    .from(feedstockDeliveries)
    .where(ilike(feedstockDeliveries.code, `${prefix}%`))
    .orderBy(desc(feedstockDeliveries.code))
    .limit(1);

  let nextNumber = 1;
  if (lastDelivery) {
    const match = lastDelivery.code.match(/FD-\d{4}-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${nextNumber.toString().padStart(3, "0")}`;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Determine delivery status based on required fields
 * Returns 'complete' if all critical fields are filled
 */
function determineDeliveryStatus(data: {
  feedstockTypeId?: string | null;
  weightKg?: number | null;
}): "missing_data" | "complete" {
  // Delivery is complete if feedstock type and weight are provided
  if (data.feedstockTypeId && data.weightKg !== null && data.weightKg !== undefined) {
    return "complete";
  }
  return "missing_data";
}
