/**
 * Storage Locations Data Access Layer
 * CRUD operations for storage locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  storageLocations,
  facilities,
  type StorageLocation,
} from "@/db/schema";
import type { StorageLocationFilterData } from "@/schemas/storage-locations";

// ============================================
// Types
// ============================================

export interface StorageLocationWithFacility extends StorageLocation {
  facilityCode: string;
  facilityName: string;
}

export interface PaginatedStorageLocations {
  items: StorageLocationWithFacility[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================
// Auth Guards
// ============================================

import { requireAuth } from "./utils";

// ============================================
// Read Operations
// ============================================

/**
 * Get all storage locations with pagination and filtering
 * Supports search, facility filter, type filter, sorting, and pagination
 */
export async function getStorageLocations(
  userId: string,
  filters?: Partial<StorageLocationFilterData>
): Promise<PaginatedStorageLocations> {
  requireAuth(userId);

  const {
    search,
    facilityId,
    type,
    page = 1,
    pageSize = 20,
    sortBy = "code",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(storageLocations.code, searchPattern),
        ilike(storageLocations.name, searchPattern)
      )!
    );
  }

  if (facilityId) {
    conditions.push(eq(storageLocations.facilityId, facilityId));
  }

  if (type) {
    conditions.push(eq(storageLocations.type, type));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: storageLocations.code,
    name: storageLocations.name,
    type: storageLocations.type,
    capacityKg: storageLocations.capacityKg,
    createdAt: storageLocations.createdAt,
    updatedAt: storageLocations.updatedAt,
  }[sortBy] ?? storageLocations.code;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(storageLocations)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get storage locations with facility info
  const storageLocationList = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      capacityKg: storageLocations.capacityKg,
      latitude: storageLocations.latitude,
      longitude: storageLocations.longitude,
      storageMethod: storageLocations.storageMethod,
      storageDescription: storageLocations.storageDescription,
      supplierReferenceId: storageLocations.supplierReferenceId,
      facilityId: storageLocations.facilityId,
      createdAt: storageLocations.createdAt,
      updatedAt: storageLocations.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(storageLocations)
    .leftJoin(facilities, eq(storageLocations.facilityId, facilities.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Transform results to include facility info
  const items: StorageLocationWithFacility[] = storageLocationList.map((sl) => ({
    id: sl.id,
    code: sl.code,
    name: sl.name,
    type: sl.type,
    capacityKg: sl.capacityKg,
    latitude: sl.latitude,
    longitude: sl.longitude,
    storageMethod: sl.storageMethod,
    storageDescription: sl.storageDescription,
    supplierReferenceId: sl.supplierReferenceId,
    facilityId: sl.facilityId,
    createdAt: sl.createdAt,
    updatedAt: sl.updatedAt,
    facilityCode: sl.facilityCode ?? "",
    facilityName: sl.facilityName ?? "",
  }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single storage location by ID
 * Returns storage location data without relations
 */
export async function getStorageLocationById(
  userId: string,
  storageLocationId: string
): Promise<StorageLocation> {
  requireAuth(userId);

  const [storageLocation] = await db
    .select()
    .from(storageLocations)
    .where(eq(storageLocations.id, storageLocationId));

  if (!storageLocation) {
    throw new Error("Storage location not found");
  }

  return storageLocation;
}

/**
 * Get a single storage location by ID with facility info
 */
export async function getStorageLocationWithFacility(
  userId: string,
  storageLocationId: string
): Promise<StorageLocationWithFacility> {
  requireAuth(userId);

  const [result] = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      capacityKg: storageLocations.capacityKg,
      latitude: storageLocations.latitude,
      longitude: storageLocations.longitude,
      storageMethod: storageLocations.storageMethod,
      storageDescription: storageLocations.storageDescription,
      supplierReferenceId: storageLocations.supplierReferenceId,
      facilityId: storageLocations.facilityId,
      createdAt: storageLocations.createdAt,
      updatedAt: storageLocations.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(storageLocations)
    .leftJoin(facilities, eq(storageLocations.facilityId, facilities.id))
    .where(eq(storageLocations.id, storageLocationId));

  if (!result) {
    throw new Error("Storage location not found");
  }

  return {
    ...result,
    facilityCode: result.facilityCode ?? "",
    facilityName: result.facilityName ?? "",
  };
}

/**
 * Get storage locations by facility ID
 */
export async function getStorageLocationsByFacility(
  userId: string,
  facilityId: string
): Promise<StorageLocation[]> {
  requireAuth(userId);

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, facilityId));

  if (!facility) {
    throw new Error("Facility not found");
  }

  return db
    .select()
    .from(storageLocations)
    .where(eq(storageLocations.facilityId, facilityId))
    .orderBy(asc(storageLocations.code));
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new storage location
 */
export async function createStorageLocation(
  userId: string,
  data: {
    code: string;
    name: string;
    type: "feedstock_bin" | "feedstock_pile" | "biochar_pile" | "product_pile";
    facilityId: string;
    capacityKg?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    storageMethod?: string | null;
    storageDescription?: string | null;
    supplierReferenceId?: string | null;
  }
): Promise<StorageLocation> {
  requireAuth(userId);

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, data.facilityId));

  if (!facility) {
    throw new Error("Facility not found");
  }

  // Check for duplicate code
  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(eq(storageLocations.code, data.code));

  if (existing) {
    throw new Error("A storage location with this code already exists");
  }

  const [storageLocation] = await db
    .insert(storageLocations)
    .values({
      code: data.code,
      name: data.name,
      type: data.type,
      facilityId: data.facilityId,
      capacityKg: data.capacityKg ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      storageMethod: data.storageMethod ?? null,
      storageDescription: data.storageDescription ?? null,
      supplierReferenceId: data.supplierReferenceId ?? null,
    })
    .returning();

  return storageLocation;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing storage location
 */
export async function updateStorageLocation(
  userId: string,
  storageLocationId: string,
  data: {
    code?: string;
    name?: string;
    type?: "feedstock_bin" | "feedstock_pile" | "biochar_pile" | "product_pile";
    facilityId?: string;
    capacityKg?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    storageMethod?: string | null;
    storageDescription?: string | null;
    supplierReferenceId?: string | null;
  }
): Promise<StorageLocation> {
  requireAuth(userId);

  // Verify storage location exists
  const [existing] = await db
    .select()
    .from(storageLocations)
    .where(eq(storageLocations.id, storageLocationId));

  if (!existing) {
    throw new Error("Storage location not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: storageLocations.id })
      .from(storageLocations)
      .where(eq(storageLocations.code, data.code));

    if (duplicate) {
      throw new Error("A storage location with this code already exists");
    }
  }

  // If facilityId is being changed, verify new facility exists
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.id, data.facilityId));

    if (!facility) {
      throw new Error("Facility not found");
    }
  }

  const [updated] = await db
    .update(storageLocations)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(storageLocations.id, storageLocationId))
    .returning();

  return updated;
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a storage location
 * Note: May fail if storage location has associated records (check in caller)
 */
export async function deleteStorageLocation(
  userId: string,
  storageLocationId: string
): Promise<void> {
  requireAuth(userId);

  // Verify storage location exists
  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(eq(storageLocations.id, storageLocationId));

  if (!existing) {
    throw new Error("Storage location not found");
  }

  // TODO: Add checks for related records if needed (e.g., feedstock batches)
  // For now, we allow deletion

  await db
    .delete(storageLocations)
    .where(eq(storageLocations.id, storageLocationId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a storage location code is available
 */
export async function isStorageLocationCodeAvailable(
  userId: string,
  code: string,
  excludeStorageLocationId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(storageLocations.code, code)];

  if (excludeStorageLocationId) {
    conditions.push(
      sql`${storageLocations.id} != ${excludeStorageLocationId}`
    );
  }

  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get unique storage types used across all storage locations
 */
export async function getStorageLocationTypes(
  userId: string
): Promise<string[]> {
  requireAuth(userId);

  const results = await db
    .selectDistinct({ type: storageLocations.type })
    .from(storageLocations)
    .orderBy(asc(storageLocations.type));

  return results.map((r) => r.type);
}
