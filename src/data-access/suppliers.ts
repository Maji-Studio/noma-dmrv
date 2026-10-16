import { fillMissingLocationDistances } from "./location-distance-fill";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import { upsertLocationFacilityDistances, withLocationFacilityDistances } from "./location-facility-distances";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";
/**
 * Suppliers Data Access Layer
 * CRUD operations for suppliers with auth guards, pagination, and filtering
 */

import { isNull, isNotNull, ne, and, asc, desc, eq, ilike, inArray, or, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  suppliers,
  supplierLocations,
  type Supplier,
  type SupplierLocation,
} from "@/db/schema";
import type { SupplierFilterData } from "@/schemas/suppliers";
import { formatSupplierLocationDisplay } from "@/lib/supplier-location-display";
import { assertRowVersion, nextVersion } from "./row-version";
import {
  findSupplierLocations,
  findSupplierRow,
  SUPPLIER_LOCATION_ORDER,
} from "./supplier-detail";

/** Entity keys on a supplier's and a supplier location's version conflicts. */
const SUPPLIER_LOCATION_CONFLICT_ENTITY = "supplierLocation";

// ============================================
// Types
// ============================================

export type SupplierWithRelations = Supplier & {
  /** Default (or first) structured source-location label for list display. */
  defaultLocationDisplay?: string | null;
};

export interface PaginatedSuppliers {
  items: SupplierWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================
// Auth Guards
// ============================================

import { requireOrgScope } from "./utils";
import { partyArchived } from "@/lib/party-domain-errors";
import { SafeError } from "@/lib/errors";

// Supplier records are organization-owned. `suppliers.userId` is retained for
// create-time attribution.
async function ensureSupplierExists(
  ctx: OrgContext,
  supplierId: string
): Promise<{ id: string }> {
  requireOrgScope(ctx);

  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organizationId, ctx.organizationId),
      ),
    );

  if (!supplier) {
    throw new SafeError("Supplier not found");
  }

  return { id: supplier.id };
}

async function ensureSupplierLocationExists(
  ctx: OrgContext,
  locationId: string
): Promise<{ id: string; supplierId: string }> {
  requireOrgScope(ctx);

  const [location] = await db
    .select({
      id: supplierLocations.id,
      supplierId: supplierLocations.supplierId,
    })
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    );

  if (!location) {
    throw new SafeError("Supplier location not found");
  }

  return { id: location.id, supplierId: location.supplierId };
}

// ============================================
// Supplier Read Operations
// ============================================

/**
 * Get all suppliers with pagination and filtering
 * Supports search, location filter, sorting, and pagination
 */
export async function getSuppliers(
  ctx: OrgContext,
  filters?: Partial<SupplierFilterData>
): Promise<PaginatedSuppliers> {
  requireOrgScope(ctx);

  const {
    search,
    archived = false,
    location,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  const conditions: SQL[] = [
    eq(suppliers.organizationId, ctx.organizationId),
    archived ? isNotNull(suppliers.archivedAt) : isNull(suppliers.archivedAt),
  ];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(suppliers.code, searchPattern),
        ilike(suppliers.name, searchPattern),
        ilike(suppliers.location, searchPattern),
        ilike(suppliers.contactName, searchPattern)
      )!
    );
  }

  if (location) {
    conditions.push(ilike(suppliers.location, location));
  }

  const whereClause = and(...conditions);

  // Build sort clause
  const sortColumn = {
    code: suppliers.code,
    name: suppliers.name,
    location: suppliers.location,
    createdAt: suppliers.createdAt,
    updatedAt: suppliers.updatedAt,
  }[sortBy] ?? suppliers.name;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  // org-scope-ok: whereClause includes the active organization predicate.
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(suppliers)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get suppliers
  const supplierList = await db
    .select({
      id: suppliers.id,
      organizationId: suppliers.organizationId,
      userId: suppliers.userId,
      code: suppliers.code,
      name: suppliers.name,
      location: suppliers.location,
      address: suppliers.address,
      contactName: suppliers.contactName,
      contactEmail: suppliers.contactEmail,
      contactPhone: suppliers.contactPhone,
      sourceRegion: suppliers.sourceRegion,
      createdAt: suppliers.createdAt,
      version: suppliers.version,
      updatedAt: suppliers.updatedAt,
      archivedAt: suppliers.archivedAt,
    })
    .from(suppliers)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  const locationRows =
    supplierList.length === 0
      ? []
      : await db
          .select({
            supplierId: supplierLocations.supplierId,
            name: supplierLocations.name,
            city: supplierLocations.city,
            stateRegion: supplierLocations.stateRegion,
            country: supplierLocations.country,
            isDefault: supplierLocations.isDefault,
          })
          .from(supplierLocations)
          .where(
            and(
              inArray(
                supplierLocations.supplierId,
                supplierList.map((supplier) => supplier.id),
              ),
              eq(supplierLocations.organizationId, ctx.organizationId),
            ),
          )
          .orderBy(...SUPPLIER_LOCATION_ORDER);

  const defaultLocationBySupplier = new Map<string, string | null>();
  for (const locationRow of locationRows) {
    if (defaultLocationBySupplier.has(locationRow.supplierId)) continue;
    defaultLocationBySupplier.set(
      locationRow.supplierId,
      formatSupplierLocationDisplay(locationRow),
    );
  }

  const items: SupplierWithRelations[] = supplierList.map((s) => ({
    ...s,
    defaultLocationDisplay: defaultLocationBySupplier.get(s.id) ?? null,
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
 * Get a single supplier by ID
 * Returns supplier data without relations
 */
export async function getSupplierById(
  ctx: OrgContext,
  supplierId: string
): Promise<Supplier> {
  requireOrgScope(ctx);
  await ensureSupplierExists(ctx, supplierId);

  const supplier = await findSupplierRow(ctx, supplierId);

  if (!supplier) {
    throw new SafeError("Supplier not found");
  }

  return supplier;
}

export async function getSupplierLocationsBySupplier(
  ctx: OrgContext,
  supplierId: string
): Promise<SupplierLocation[]> {
  requireOrgScope(ctx);
  await ensureSupplierExists(ctx, supplierId);

  return findSupplierLocations(ctx, supplierId);
}

export async function createSupplierLocation(
  ctx: OrgContext,
  data: {
    supplierId: string;
    name?: string | null;
    country: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude: number;
    gpsLongitude: number;
    address?: string | null;
    facilityDistances?: FacilityDistanceInput[];
    isDefault?: boolean;
  }
): Promise<SupplierLocation> {
  requireOrgScope(ctx);
  await ensureSupplierExists(ctx, data.supplierId);

  const saved = await db.transaction(async (tx) => {
    // Match intake writers: active facilities before the supplier parent.
    for (const row of [...(data.facilityDistances ?? [])].sort((a, b) => a.facilityId.localeCompare(b.facilityId))) {
      if (row.distanceKm !== null) await lockActiveFacilityReference(ctx, tx, row.facilityId);
    }
    // Serialize location writers with parent deletion before locking children.
    // Pair saves also wait for intake FK inserts, so fill-only cannot miss an
    // intake committing with a missing distance. The lock does not bump version.
    const [parent] = await tx.select({ id: suppliers.id, code: suppliers.code, archivedAt: suppliers.archivedAt })
      .from(suppliers)
      .where(and(eq(suppliers.id, data.supplierId), eq(suppliers.organizationId, ctx.organizationId)))
      .for(data.facilityDistances?.length ? "update" : "no key update");
    if (!parent) throw new SafeError("Supplier not found");
    if (parent.archivedAt) throw partyArchived("supplier", parent.code);

    // The supplier's first location is always its default.
    const [{ value: existingCount }] = await tx
      .select({ value: count() })
      .from(supplierLocations)
      .where(
        and(
          eq(supplierLocations.supplierId, data.supplierId),
          eq(supplierLocations.organizationId, ctx.organizationId),
        ),
      );
    const makeDefault = data.isDefault === true || existingCount === 0;

    // Clear the prior default first so the partial unique index never sees two.
    if (makeDefault) {
      await tx
        .update(supplierLocations)
        .set({ version: nextVersion(supplierLocations.version), isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(supplierLocations.supplierId, data.supplierId),
            eq(supplierLocations.organizationId, ctx.organizationId),
            eq(supplierLocations.isDefault, true)
          )
        );
    }

    const [location] = await tx
      .insert(supplierLocations)
      .values({
        organizationId: ctx.organizationId,
        supplierId: data.supplierId,
        name: data.name ?? null,
        country: data.country,
        stateRegion: data.stateRegion ?? null,
        city: data.city ?? null,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        address: data.address ?? null,
        isDefault: makeDefault,
      })
      .returning();

    await upsertLocationFacilityDistances(ctx, tx, "supplier", location.id, data.facilityDistances);
    return (await withLocationFacilityDistances(ctx, "supplier", [location], tx))[0];
  });
  await processPendingStorageObjectDeletions(ctx);
  return saved;
}

export async function updateSupplierLocation(
  ctx: OrgContext,
  locationId: string,
  data: {
    name?: string | null;
    country?: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude?: number;
    gpsLongitude?: number;
    address?: string | null;
    facilityDistances?: FacilityDistanceInput[];
    isDefault?: boolean;
    /** `version` the edit form loaded; refuses a save built on a stale read. */
    expectedVersion: number;
  }
): Promise<SupplierLocation> {
  requireOrgScope(ctx);
  const { supplierId } = await ensureSupplierLocationExists(ctx, locationId);
  const { expectedVersion, facilityDistances, ...locationData } = data;

  const saved = await db.transaction(async (tx) => {
    // Discover promotion pairs before taking facilities, then the supplier lock.
    // The location version check below rejects concurrent pair edits.
    const promotionPairs = data.isDefault === true
      ? (await withLocationFacilityDistances(ctx, "supplier", [{ id: locationId }], tx))[0].facilityDistances
      : [];
    const pairsToLock = new Map<string, FacilityDistanceInput>(promotionPairs.map(row => [row.facilityId, row]));
    for (const row of facilityDistances ?? []) {
      if (row.distanceKm === null) pairsToLock.delete(row.facilityId);
      else pairsToLock.set(row.facilityId, row);
    }
    // Match intake writers: active facilities before the supplier parent.
    for (const row of [...pairsToLock.values()].sort((a, b) => a.facilityId.localeCompare(b.facilityId))) {
      if (row.distanceKm !== null) await lockActiveFacilityReference(ctx, tx, row.facilityId);
    }
    // Serialize location writers with parent deletion before locking children.
    // Pair saves also wait for intake FK inserts, so fill-only cannot miss an
    // intake committing with a missing distance. The lock does not bump version.
    const [parent] = await tx.select({ id: suppliers.id, code: suppliers.code, archivedAt: suppliers.archivedAt })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, ctx.organizationId)))
      .for(data.facilityDistances?.length || promotionPairs.length ? "update" : "no key update");
    if (!parent) throw new SafeError("Supplier not found");
    if (parent.archivedAt) throw partyArchived("supplier", parent.code);

    const [locked] = await tx
      .select({ version: supplierLocations.version, isDefault: supplierLocations.isDefault })
      .from(supplierLocations)
      .where(
        and(
          eq(supplierLocations.id, locationId),
          eq(supplierLocations.organizationId, ctx.organizationId),
        ),
      )
      .for("update");

    if (!locked) {
      throw new SafeError("Supplier location not found");
    }
    // The default moves only by setting another location as default.
    if (locked.isDefault && locationData.isDefault === false) {
      locationData.isDefault = true;
    }
    assertRowVersion({
      entity: SUPPLIER_LOCATION_CONFLICT_ENTITY,
      id: locationId,
      expectedVersion,
      actualVersion: locked.version,
    });

    // Promoting this location to default demotes the supplier's current default.
    if (data.isDefault === true) {
      await tx
        .update(supplierLocations)
        .set({ version: nextVersion(supplierLocations.version), isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(supplierLocations.supplierId, supplierId),
            eq(supplierLocations.organizationId, ctx.organizationId),
            eq(supplierLocations.isDefault, true),
            ne(supplierLocations.id, locationId)
          )
        );
    }

    const [updated] = await tx
      .update(supplierLocations)
      .set({
        ...locationData,
        version: nextVersion(supplierLocations.version),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supplierLocations.id, locationId),
          eq(supplierLocations.organizationId, ctx.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      throw new SafeError("Supplier location not found");
    }

    const promotingDefault = data.isDefault === true && !locked.isDefault;
    // Promotion must lock all eligible feedstocks in one ascending-id pass,
    // matching vehicle edits, rather than filling changed pairs first.
    await upsertLocationFacilityDistances(ctx, tx, "supplier", locationId, facilityDistances, { deferFill: promotingDefault });
    const result = (await withLocationFacilityDistances(ctx, "supplier", [updated], tx))[0];
    if (promotingDefault) {
      await fillMissingLocationDistances(ctx, tx, "supplier", locationId, result.facilityDistances);
    }
    return result;
  });
  await processPendingStorageObjectDeletions(ctx);
  return saved;
}

export async function deleteSupplierLocation(
  ctx: OrgContext,
  locationId: string,
  expectedVersion: number
): Promise<void> {
  requireOrgScope(ctx);
  const { supplierId } = await ensureSupplierLocationExists(ctx, locationId);
  return db.transaction(async (tx) => {
    // Serialize location writers with parent deletion before locking children,
    // matching create/update. A lock alone does not change the supplier's version.
    const [parent] = await tx.select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, ctx.organizationId)))
      .for("no key update");
    if (!parent) throw new SafeError("Supplier not found");

    const [versioned] = await tx.select({ version: supplierLocations.version })
      .from(supplierLocations)
      .where(and(eq(supplierLocations.id, locationId), eq(supplierLocations.organizationId, ctx.organizationId)))
      .for("update");
    if (!versioned) throw new SafeError("Supplier location not found");
    assertRowVersion({ entity: SUPPLIER_LOCATION_CONFLICT_ENTITY, id: locationId, expectedVersion, actualVersion: versioned.version });

    const deleted = await tx
      .delete(supplierLocations)
      .where(
        and(
          eq(supplierLocations.id, locationId),
          eq(supplierLocations.organizationId, ctx.organizationId),
        ),
      )
      .returning({
        id: supplierLocations.id,
        supplierId: supplierLocations.supplierId,
        isDefault: supplierLocations.isDefault,
      });

    if (deleted.length === 0) {
      throw new SafeError("Supplier location not found");
    }

    // Deleting the default promotes the first remaining location (in list
    // order) so a supplier with locations always has a default.
    const [gone] = deleted;
    if (gone.isDefault) {
      const [next] = await tx
        .select({ id: supplierLocations.id })
        .from(supplierLocations)
        .where(
          and(
            eq(supplierLocations.supplierId, gone.supplierId),
            eq(supplierLocations.organizationId, ctx.organizationId),
          ),
        )
        .orderBy(...SUPPLIER_LOCATION_ORDER)
        .limit(1)
        .for("update");
      if (next) {
        await tx
          .update(supplierLocations)
          .set({ version: nextVersion(supplierLocations.version), isDefault: true, updatedAt: new Date() })
          .where(and(eq(supplierLocations.id, next.id), eq(supplierLocations.organizationId, ctx.organizationId)));
      }
    }

  });
}
