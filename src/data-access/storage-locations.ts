/**
 * Storage Locations Data Access Layer
 * CRUD operations for storage locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, isNull, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  storageLocations,
  facilities,
  feedstocks,
  feedstockTypes,
  productionRuns,
  biocharProducts,
  biocharStorageInventory,
  formulations,
  deliveries,
  type StorageLocation,
} from "@/db/schema";
import {
  isFeedstockBinType,
  type StorageLocationFilterData,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";
import { enrichStorageLocationRows } from "./storage-location-enrichment";
import type {
  StorageLocationWithFacility,
  PaginatedStorageLocations,
  StorageLocationLastActivity,
} from "./storage-location-enrichment";

// Re-exported so existing importers (hooks, fn) keep their import paths.
export type {
  StorageLocationWithFacility,
  PaginatedStorageLocations,
  StorageLocationLastActivity,
};

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

  // Build where conditions — archived bins (facility archive cascade) are hidden
  const conditions: SQL[] = [isNull(storageLocations.archivedAt)];

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

  const whereClause = and(...conditions);

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
      storageMethod: storageLocations.storageMethod,
      storageDescription: storageLocations.storageDescription,
      supplierReferenceId: storageLocations.supplierReferenceId,
      feedstockTypeId: storageLocations.feedstockTypeId,
      formulationId: storageLocations.formulationId,
      facilityId: storageLocations.facilityId,
      archivedAt: storageLocations.archivedAt,
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

  const items = await enrichStorageLocationRows(userId, storageLocationList);

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
    throw new SafeError("Storage location not found");
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
      storageMethod: storageLocations.storageMethod,
      storageDescription: storageLocations.storageDescription,
      supplierReferenceId: storageLocations.supplierReferenceId,
      feedstockTypeId: storageLocations.feedstockTypeId,
      formulationId: storageLocations.formulationId,
      facilityId: storageLocations.facilityId,
      archivedAt: storageLocations.archivedAt,
      createdAt: storageLocations.createdAt,
      updatedAt: storageLocations.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
    })
    .from(storageLocations)
    .leftJoin(facilities, eq(storageLocations.facilityId, facilities.id))
    .where(eq(storageLocations.id, storageLocationId));

  if (!result) {
    throw new SafeError("Storage location not found");
  }

  const [enriched] = await enrichStorageLocationRows(userId, [result]);

  return enriched;
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
    throw new SafeError("Facility not found");
  }

  return db
    .select()
    .from(storageLocations)
    .where(and(eq(storageLocations.facilityId, facilityId), isNull(storageLocations.archivedAt)))
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
    type: "feedstock_bin" | "biochar_bin" | "product_bin";
    facilityId: string;
    capacityKg?: number | null;
    feedstockTypeId?: string | null;
    formulationId?: string | null;
    storageMethod?: string | null;
    storageDescription?: string | null;
    supplierReferenceId?: string | null;
  }
): Promise<StorageLocation> {
  requireAuth(userId);

  // Verify facility exists and is active (no new children under an archived parent)
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, data.facilityId), isNull(facilities.archivedAt)));

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }

  // Check for duplicate code
  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(eq(storageLocations.code, data.code));

  if (existing) {
    throw new SafeError("A storage location with this code already exists");
  }

  if (data.feedstockTypeId) {
    const [feedstockType] = await db
      .select({ id: feedstockTypes.id })
      .from(feedstockTypes)
      .where(eq(feedstockTypes.id, data.feedstockTypeId));

    if (!feedstockType) {
      throw new SafeError("Feedstock type not found");
    }
  }

  // The Zod create schema enforces this for form/fn flows; repeat it here so
  // direct data-access callers (seeds, scripts) can't create a bin the update
  // path's invariant check would then refuse to touch.
  if (isFeedstockBinType(data.type) && !data.feedstockTypeId) {
    throw new SafeError(
      "Feedstock bins must be restricted to one feedstock type"
    );
  }

  // A formulation only makes sense on a product bin; ignore it for other types.
  const formulationId = data.type === "product_bin" ? data.formulationId ?? null : null;
  if (formulationId) {
    const [formulation] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(eq(formulations.id, formulationId));

    if (!formulation) {
      throw new SafeError("Formulation not found");
    }
  }

  const [storageLocation] = await db
    .insert(storageLocations)
    .values({
      code: data.code,
      name: data.name,
      type: data.type,
      facilityId: data.facilityId,
      capacityKg: data.capacityKg ?? null,
      // Only meaningful on feedstock bins, like formulationId below.
      feedstockTypeId: isFeedstockBinType(data.type)
        ? data.feedstockTypeId ?? null
        : null,
      formulationId,
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
    type?: "feedstock_bin" | "biochar_bin" | "product_bin";
    facilityId?: string;
    capacityKg?: number | null;
    feedstockTypeId?: string | null;
    formulationId?: string | null;
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
    throw new SafeError("Storage location not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: storageLocations.id })
      .from(storageLocations)
      .where(eq(storageLocations.code, data.code));

    if (duplicate) {
      throw new SafeError("A storage location with this code already exists");
    }
  }

  // If facilityId is being changed, verify new facility exists and is active
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), isNull(facilities.archivedAt)));

    if (!facility) {
      throw new SafeError("Facility not found or archived");
    }
  }

  if (data.feedstockTypeId) {
    const [feedstockType] = await db
      .select({ id: feedstockTypes.id })
      .from(feedstockTypes)
      .where(eq(feedstockTypes.id, data.feedstockTypeId));

    if (!feedstockType) {
      throw new SafeError("Feedstock type not found");
    }
  }

  const effectiveType = data.type ?? existing.type;

  // The Zod update schema can only see the payload — when `type` is omitted it
  // cannot tell this is a feedstock bin, so an update could clear
  // feedstockTypeId on one. Enforce the invariant against the effective row.
  const effectiveFeedstockTypeId =
    data.feedstockTypeId !== undefined
      ? data.feedstockTypeId
      : existing.feedstockTypeId;
  if (
    isFeedstockBinType(effectiveType as StorageLocationType) &&
    !effectiveFeedstockTypeId
  ) {
    throw new SafeError(
      "Feedstock bins must be restricted to one feedstock type"
    );
  }

  // A feedstock type only makes sense on a feedstock bin — clear it
  // when the (effective) type is anything else, same as formulationId below.
  const normalizedFeedstockTypeId = isFeedstockBinType(
    effectiveType as StorageLocationType
  )
    ? effectiveFeedstockTypeId ?? null
    : null;

  const normalizedFormulationId =
    effectiveType === "product_bin"
      ? (data.formulationId !== undefined
          ? data.formulationId
          : existing.formulationId) ?? null
      : null;

  if (normalizedFormulationId) {
    const [formulation] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(eq(formulations.id, normalizedFormulationId));

    if (!formulation) {
      throw new SafeError("Formulation not found");
    }
  }

  // Don't let a product bin's formulation be re-pointed while it still holds
  // product of a different formulation — that would dirty the bin. `IS DISTINCT
  // FROM` handles NULL correctly (a pure-biochar product vs a named formulation
  // counts as a mismatch, and vice versa).
  if (effectiveType === "product_bin") {
    const [conflicting] = await db
      .select({ id: biocharProducts.id })
      .from(biocharProducts)
      .where(
        and(
          eq(biocharProducts.storageLocationId, storageLocationId),
          sql`${biocharProducts.formulationId} IS DISTINCT FROM ${normalizedFormulationId}`
        )
      )
      .limit(1);

    if (conflicting) {
      throw new SafeError(
        "This bin already holds product with a different formulation — move or remove it before changing the bin's formulation."
      );
    }
  }

  const dataWithoutNormalized = { ...data };
  delete dataWithoutNormalized.formulationId;
  delete dataWithoutNormalized.feedstockTypeId;
  const [updated] = await db
    .update(storageLocations)
    .set({
      ...dataWithoutNormalized,
      feedstockTypeId: normalizedFeedstockTypeId,
      formulationId: normalizedFormulationId,
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
    throw new SafeError("Storage location not found");
  }

  const [
    [{ value: feedstockCount }],
    [{ value: feedstockRunCount }],
    [{ value: biocharRunCount }],
    [{ value: productCount }],
    [{ value: deliveryCount }],
    [{ value: inventoryCount }],
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(feedstocks)
      .where(eq(feedstocks.storageLocationId, storageLocationId)),
    db
      .select({ value: count() })
      .from(productionRuns)
      .where(eq(productionRuns.feedstockStorageLocationId, storageLocationId)),
    db
      .select({ value: count() })
      .from(productionRuns)
      .where(eq(productionRuns.biocharStorageLocationId, storageLocationId)),
    db
      .select({ value: count() })
      .from(biocharProducts)
      .where(eq(biocharProducts.storageLocationId, storageLocationId)),
    db
      .select({ value: count() })
      .from(deliveries)
      .where(eq(deliveries.storageLocationId, storageLocationId)),
    db
      .select({ value: count() })
      .from(biocharStorageInventory)
      .where(eq(biocharStorageInventory.storageLocationId, storageLocationId)),
  ]);

  const blockers = [
    Number(feedstockCount) > 0 ? "feedstock batches" : null,
    Number(feedstockRunCount) > 0 ? "production runs using it as a feedstock bin" : null,
    Number(biocharRunCount) > 0 ? "production runs using it as a biochar bin" : null,
    Number(productCount) > 0 ? "biochar products stored in it" : null,
    Number(deliveryCount) > 0 ? "deliveries drawing from it" : null,
    Number(inventoryCount) > 0 ? "storage inventory records" : null,
  ].filter(Boolean);

  if (blockers.length > 0) {
    throw new SafeError(
      `Cannot delete this storage location while it has ${blockers.join(", ")}. Move or remove those records first.`
    );
  }

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
    .where(isNull(storageLocations.archivedAt))
    .orderBy(asc(storageLocations.type));

  return results.map((r) => r.type);
}
