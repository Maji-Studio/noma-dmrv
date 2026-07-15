/**
 * Storage Locations Data Access Layer
 * CRUD operations for storage locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, isNull, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
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
import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { guardStorageLocationName } from "./unique-name-guards";
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
  ctx: OrgContext,
  filters?: Partial<StorageLocationFilterData>
): Promise<PaginatedStorageLocations> {
  requireOrgScope(ctx);

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
  const conditions: SQL[] = [eq(storageLocations.organizationId, ctx.organizationId), isNull(storageLocations.archivedAt)];

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
  // org-scope-ok: whereClause includes the active organization predicate.
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
      organizationId: storageLocations.organizationId,
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
    .leftJoin(
      facilities,
      and(
        eq(storageLocations.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  const items = await enrichStorageLocationRows(ctx, storageLocationList);

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
  ctx: OrgContext,
  storageLocationId: string
): Promise<StorageLocation> {
  requireOrgScope(ctx);

  const [storageLocation] = await db
    .select()
    .from(storageLocations)
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!storageLocation) {
    throw new SafeError("Storage location not found");
  }

  return storageLocation;
}

/**
 * Get a single storage location by ID with facility info
 */
export async function getStorageLocationWithFacility(
  ctx: OrgContext,
  storageLocationId: string
): Promise<StorageLocationWithFacility> {
  requireOrgScope(ctx);

  const [result] = await db
    .select({
      id: storageLocations.id,
      organizationId: storageLocations.organizationId,
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
    .leftJoin(
      facilities,
      and(
        eq(storageLocations.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!result) {
    throw new SafeError("Storage location not found");
  }

  const [enriched] = await enrichStorageLocationRows(ctx, [result]);

  return enriched;
}

/**
 * Get storage locations by facility ID
 */
export async function getStorageLocationsByFacility(
  ctx: OrgContext,
  facilityId: string
): Promise<StorageLocation[]> {
  requireOrgScope(ctx);

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

  if (!facility) {
    throw new SafeError("Facility not found");
  }

  return db
    .select()
    .from(storageLocations)
    .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.organizationId, ctx.organizationId), isNull(storageLocations.archivedAt)))
    .orderBy(asc(storageLocations.code));
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new storage location
 */
export async function createStorageLocation(
  ctx: OrgContext,
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
  requireOrgScope(ctx);

  // Verify facility exists and is active (no new children under an archived parent)
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }

  if (data.feedstockTypeId) {
    const [feedstockType] = await db
      .select({ id: feedstockTypes.id })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

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
      .where(and(eq(formulations.id, formulationId), eq(formulations.organizationId, ctx.organizationId)));

    if (!formulation) {
      throw new SafeError("Formulation not found");
    }
  }

  const [storageLocation] = await guardStorageLocationName(ctx, data.name, () =>
    db
      .insert(storageLocations)
      .values({
        organizationId: ctx.organizationId,
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
      .returning()
  );

  return storageLocation;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing storage location
 */
export async function updateStorageLocation(
  ctx: OrgContext,
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
  requireOrgScope(ctx);

  // Verify storage location exists
  const [existing] = await db
    .select()
    .from(storageLocations)
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Storage location not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: storageLocations.id })
      .from(storageLocations)
      .where(and(eq(storageLocations.code, data.code), eq(storageLocations.organizationId, ctx.organizationId)));

    if (duplicate) {
      throw new SafeError("A storage location with this code already exists");
    }
  }

  // If facilityId is being changed, verify new facility exists and is active
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

    if (!facility) {
      throw new SafeError("Facility not found or archived");
    }
  }

  if (data.feedstockTypeId) {
    const [feedstockType] = await db
      .select({ id: feedstockTypes.id })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

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
      .where(and(eq(formulations.id, normalizedFormulationId), eq(formulations.organizationId, ctx.organizationId)));

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
          eq(biocharProducts.organizationId, ctx.organizationId),
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
  // A rename OR a facility move can collide with the per-facility name index.
  const [updated] = await guardStorageLocationName(
    ctx,
    data.name ?? existing.name,
    () =>
      db
        .update(storageLocations)
        .set({
          ...dataWithoutNormalized,
          feedstockTypeId: normalizedFeedstockTypeId,
          formulationId: normalizedFormulationId,
          updatedAt: new Date(),
        })
        .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)))
        .returning()
  );

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
  ctx: OrgContext,
  storageLocationId: string
): Promise<void> {
  requireOrgScope(ctx);

  // Verify storage location exists
  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

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
      .where(and(eq(feedstocks.storageLocationId, storageLocationId), eq(feedstocks.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(productionRuns)
      .where(and(eq(productionRuns.feedstockStorageLocationId, storageLocationId), eq(productionRuns.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(productionRuns)
      .where(and(eq(productionRuns.biocharStorageLocationId, storageLocationId), eq(productionRuns.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.storageLocationId, storageLocationId), eq(biocharProducts.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(deliveries)
      .where(and(eq(deliveries.storageLocationId, storageLocationId), eq(deliveries.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(biocharStorageInventory)
      .where(and(eq(biocharStorageInventory.storageLocationId, storageLocationId), eq(biocharStorageInventory.organizationId, ctx.organizationId))),
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
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a storage location code is available
 */
export async function isStorageLocationCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeStorageLocationId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(storageLocations.code, code), eq(storageLocations.organizationId, ctx.organizationId)];

  if (excludeStorageLocationId) {
    conditions.push(
      sql`${storageLocations.id} != ${excludeStorageLocationId}`
    );
  }

  // org-scope-ok: organization predicate is composed in conditions above.
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
  ctx: OrgContext
): Promise<string[]> {
  requireOrgScope(ctx);

  const results = await db
    .selectDistinct({ type: storageLocations.type })
    .from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), isNull(storageLocations.archivedAt)))
    .orderBy(asc(storageLocations.type));

  return results.map((r) => r.type);
}
