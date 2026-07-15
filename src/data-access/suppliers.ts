/**
 * Suppliers Data Access Layer
 * CRUD operations for suppliers with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { suppliers, supplierLocations, feedstocks, type Supplier, type SupplierLocation } from "@/db/schema";
import type { SupplierFilterData } from "@/schemas/suppliers";
import type { DistanceSourceValue } from "@/schemas/distance-source";

// ============================================
// Types
// ============================================

export type SupplierWithRelations = Supplier;

interface SupplierCreateFields {
  code: string;
  name: string;
  location?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  address?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  sourceRegion?: string | null;
  distanceToFacilityKm?: number | null;
  distanceSource?: DistanceSourceValue | null;
}

interface SupplierLocationCreateFields {
  name?: string | null;
  country: string;
  stateRegion?: string | null;
  city?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  address?: string | null;
  distanceFromFacilityKm?: number | null;
  distanceSource?: DistanceSourceValue | null;
  isDefault?: boolean;
}

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
import { SafeError } from "@/lib/errors";
import { guardSupplierName } from "./unique-name-guards";

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
    location,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  const conditions: SQL[] = [
    eq(suppliers.organizationId, ctx.organizationId),
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
      gpsLatitude: suppliers.gpsLatitude,
      gpsLongitude: suppliers.gpsLongitude,
      address: suppliers.address,
      contactName: suppliers.contactName,
      contactEmail: suppliers.contactEmail,
      contactPhone: suppliers.contactPhone,
      sourceRegion: suppliers.sourceRegion,
      distanceToFacilityKm: suppliers.distanceToFacilityKm,
      distanceSource: suppliers.distanceSource,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
    })
    .from(suppliers)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Combine data (can be extended with computed fields)
  const items: SupplierWithRelations[] = supplierList.map((s) => ({
    ...s,
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
  await ensureSupplierExists(ctx, supplierId);

  const [supplier] = await db
    .select()
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

  return supplier;
}

// ============================================
// Supplier Create Operations
// ============================================

/**
 * Create a new supplier
 */
export async function createSupplier(
  ctx: OrgContext,
  data: SupplierCreateFields
): Promise<Supplier> {
  requireOrgScope(ctx);

  // Insert-time code violations stay raw so `withAutoCode` can retry races.
  const [supplier] = await guardSupplierName(ctx, data.name, () =>
    db
      .insert(suppliers)
      .values({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        code: data.code,
        name: data.name,
        location: data.location ?? null,
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
        address: data.address ?? null,
        contactName: data.contactName ?? null,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        sourceRegion: data.sourceRegion ?? null,
        distanceToFacilityKm: data.distanceToFacilityKm ?? null,
        distanceSource: data.distanceSource ?? null,
      })
      .returning()
  );

  return supplier;
}

export async function createSupplierWithLocations(
  ctx: OrgContext,
  data: SupplierCreateFields & { locations: SupplierLocationCreateFields[] }
): Promise<Supplier> {
  requireOrgScope(ctx);

  if (data.locations.length === 0) {
    throw new SafeError("At least one location is required");
  }

  // Supplier + all initial locations commit (or roll back) together. The
  // in-transaction pre-check covers an already-committed duplicate code; an
  // insert-time unique violation (concurrent auto-code collision) propagates
  // raw so withAutoCode can detect and retry it. Mirrors createFacility.
  return guardSupplierName(ctx, data.name, () =>
    db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.code, data.code),
          eq(suppliers.organizationId, ctx.organizationId),
        ),
      );

    if (existing) {
      throw new SafeError("A supplier with this code already exists");
    }

    const [supplier] = await tx
      .insert(suppliers)
      .values({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        code: data.code,
        name: data.name,
        location: data.location ?? null,
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
        address: data.address ?? null,
        contactName: data.contactName ?? null,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        sourceRegion: data.sourceRegion ?? null,
        distanceToFacilityKm: data.distanceToFacilityKm ?? null,
        distanceSource: data.distanceSource ?? null,
      })
      .returning();

    let defaultIndex = 0;
    data.locations.forEach((location, index) => {
      if (location.isDefault === true) defaultIndex = index;
    });

    await tx.insert(supplierLocations).values(
      data.locations.map((location, index) => ({
        organizationId: ctx.organizationId,
        supplierId: supplier.id,
        name: location.name ?? null,
        country: location.country,
        stateRegion: location.stateRegion ?? null,
        city: location.city ?? null,
        gpsLatitude: location.gpsLatitude ?? null,
        gpsLongitude: location.gpsLongitude ?? null,
        address: location.address ?? null,
        distanceFromFacilityKm: location.distanceFromFacilityKm ?? null,
        distanceSource: location.distanceSource ?? null,
        isDefault: index === defaultIndex,
      }))
    );

    return supplier;
    })
  );
}

// ============================================
// Supplier Update Operations
// ============================================

/**
 * Update an existing supplier
 */
export async function updateSupplier(
  ctx: OrgContext,
  supplierId: string,
  data: {
    code?: string;
    name?: string;
    location?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    address?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    sourceRegion?: string | null;
    distanceToFacilityKm?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
  }
): Promise<Supplier> {
  await ensureSupplierExists(ctx, supplierId);

  // Verify supplier exists
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organizationId, ctx.organizationId),
      ),
    );

  if (!existing) {
    throw new SafeError("Supplier not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.code, data.code),
          eq(suppliers.organizationId, ctx.organizationId),
        ),
      );

    if (duplicate) {
      throw new SafeError("A supplier with this code already exists");
    }
  }

  const [updated] = await guardSupplierName(
    ctx,
    data.name ?? existing.name,
    () =>
      db
        .update(suppliers)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(suppliers.id, supplierId),
            eq(suppliers.organizationId, ctx.organizationId),
          ),
        )
        .returning()
  );

  if (!updated) {
    throw new SafeError("Supplier not found");
  }

  return updated;
}

// ============================================
// Supplier Delete Operations
// ============================================

/**
 * Delete a supplier
 * Will fail if supplier has associated feedstocks
 */
export async function deleteSupplier(
  ctx: OrgContext,
  supplierId: string
): Promise<void> {
  await ensureSupplierExists(ctx, supplierId);

  // Verify supplier exists
  const [existing] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organizationId, ctx.organizationId),
      ),
    );

  if (!existing) {
    throw new SafeError("Supplier not found");
  }

  const [feedstockCount] = await db
    .select({ count: count() })
    .from(feedstocks)
    .where(
      and(
        eq(feedstocks.supplierId, supplierId),
        eq(feedstocks.organizationId, ctx.organizationId),
      ),
    );

  if (Number(feedstockCount.count) > 0) {
    throw new SafeError(
      "Cannot delete supplier with associated feedstock intakes. Remove intakes first."
    );
  }

  // Delete supplier locations first (FK constraint)
  await db.delete(supplierLocations).where(
    and(
      eq(supplierLocations.supplierId, supplierId),
      eq(supplierLocations.organizationId, ctx.organizationId),
    ),
  );

  await db.delete(suppliers).where(
    and(
      eq(suppliers.id, supplierId),
      eq(suppliers.organizationId, ctx.organizationId),
    ),
  );
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a supplier code is available
 */
export async function isSupplierCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeSupplierId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(suppliers.code, code),
    eq(suppliers.organizationId, ctx.organizationId),
  ];

  if (excludeSupplierId) {
    conditions.push(sql`${suppliers.id} != ${excludeSupplierId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get unique locations from all suppliers
 * Useful for filter dropdowns
 */
export async function getSupplierLocations(ctx: OrgContext): Promise<string[]> {
  requireOrgScope(ctx);

  const results = await db
    .selectDistinct({ location: suppliers.location })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.organizationId, ctx.organizationId),
        sql`${suppliers.location} IS NOT NULL AND ${suppliers.location} != ''`,
      ),
    )
    .orderBy(asc(suppliers.location));

  return results.map((r) => r.location!).filter(Boolean);
}

/**
 * Get supplier options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getSupplierOptions(
  ctx: OrgContext
): Promise<Array<{ id: string; code: string; name: string }>> {
  requireOrgScope(ctx);

  return db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
    })
    .from(suppliers)
    .where(eq(suppliers.organizationId, ctx.organizationId))
    .orderBy(asc(suppliers.name));
}

// ============================================
// Supplier Location Operations
// ============================================

export async function getSupplierLocationsBySupplier(
  ctx: OrgContext,
  supplierId: string
): Promise<SupplierLocation[]> {
  requireOrgScope(ctx);
  await ensureSupplierExists(ctx, supplierId);

  return db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(asc(supplierLocations.country));
}

export async function getSupplierLocationById(
  ctx: OrgContext,
  locationId: string
): Promise<SupplierLocation> {
  requireOrgScope(ctx);
  await ensureSupplierLocationExists(ctx, locationId);

  const [location] = await db
    .select()
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

  return location;
}

export async function createSupplierLocation(
  ctx: OrgContext,
  data: {
    supplierId: string;
    name?: string | null;
    country: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    address?: string | null;
    distanceFromFacilityKm?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    isDefault?: boolean;
  }
): Promise<SupplierLocation> {
  requireOrgScope(ctx);
  await ensureSupplierExists(ctx, data.supplierId);

  return db.transaction(async (tx) => {
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
        .set({ isDefault: false, updatedAt: new Date() })
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
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
        address: data.address ?? null,
        distanceFromFacilityKm: data.distanceFromFacilityKm ?? null,
        distanceSource: data.distanceSource ?? null,
        isDefault: makeDefault,
      })
      .returning();

    return location;
  });
}

export async function updateSupplierLocation(
  ctx: OrgContext,
  locationId: string,
  data: {
    name?: string | null;
    country?: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    address?: string | null;
    distanceFromFacilityKm?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    isDefault?: boolean;
  }
): Promise<SupplierLocation> {
  requireOrgScope(ctx);
  const { supplierId } = await ensureSupplierLocationExists(ctx, locationId);

  return db.transaction(async (tx) => {
    // Promoting this location to default demotes the supplier's current default.
    if (data.isDefault === true) {
      await tx
        .update(supplierLocations)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(supplierLocations.supplierId, supplierId),
            eq(supplierLocations.organizationId, ctx.organizationId),
            eq(supplierLocations.isDefault, true)
          )
        );
    }

    const [updated] = await tx
      .update(supplierLocations)
      .set({
        ...data,
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

    return updated;
  });
}

export async function deleteSupplierLocation(
  ctx: OrgContext,
  locationId: string
): Promise<void> {
  requireOrgScope(ctx);
  await ensureSupplierLocationExists(ctx, locationId);

  const deleted = await db
    .delete(supplierLocations)
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: supplierLocations.id });

  if (deleted.length === 0) {
    throw new SafeError("Supplier location not found");
  }
}
