/**
 * Suppliers Data Access Layer
 * CRUD operations for suppliers with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import { suppliers, supplierLocations, feedstocks, type Supplier, type SupplierLocation } from "@/db/schema";
import type { SupplierFilterData } from "@/schemas/suppliers";

// ============================================
// Types
// ============================================

export type SupplierWithRelations = Supplier;

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

import { requireAuth } from "./utils";

async function ensureSupplierOwnership(
  userId: string,
  supplierId: string
): Promise<{ id: string }> {
  requireAuth(userId);

  const [supplier] = await db
    .select({ id: suppliers.id, userId: suppliers.userId })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId));

  if (!supplier) {
    throw new Error("Supplier not found");
  }
  if (supplier.userId !== userId) {
    throw new Error("Unauthorized");
  }

  return { id: supplier.id };
}

async function ensureSupplierLocationOwnership(
  userId: string,
  locationId: string
): Promise<{ id: string; supplierId: string }> {
  requireAuth(userId);

  const [location] = await db
    .select({
      id: supplierLocations.id,
      supplierId: supplierLocations.supplierId,
      ownerUserId: suppliers.userId,
    })
    .from(supplierLocations)
    .innerJoin(suppliers, eq(supplierLocations.supplierId, suppliers.id))
    .where(eq(supplierLocations.id, locationId));

  if (!location) {
    throw new Error("Supplier location not found");
  }
  if (location.ownerUserId !== userId) {
    throw new Error("Unauthorized");
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
  userId: string,
  filters?: Partial<SupplierFilterData>
): Promise<PaginatedSuppliers> {
  requireAuth(userId);

  const {
    search,
    location,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions — always scoped to the current user
  const conditions: SQL[] = [eq(suppliers.userId, userId)];

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
  userId: string,
  supplierId: string
): Promise<Supplier> {
  await ensureSupplierOwnership(userId, supplierId);

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, supplierId));

  if (!supplier) {
    throw new Error("Supplier not found");
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
  userId: string,
  data: {
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
  }
): Promise<Supplier> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.code, data.code));

  if (existing) {
    throw new Error("A supplier with this code already exists");
  }

  try {
    const [supplier] = await db
      .insert(suppliers)
      .values({
        userId,
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
      })
      .returning();

    return supplier;
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new Error("A supplier with this code already exists");
    }
    throw error;
  }
}

// ============================================
// Supplier Update Operations
// ============================================

/**
 * Update an existing supplier
 */
export async function updateSupplier(
  userId: string,
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
  }
): Promise<Supplier> {
  await ensureSupplierOwnership(userId, supplierId);

  // Verify supplier exists
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, supplierId));

  if (!existing) {
    throw new Error("Supplier not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.code, data.code));

    if (duplicate) {
      throw new Error("A supplier with this code already exists");
    }
  }

  const [updated] = await db
    .update(suppliers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, supplierId))
    .returning();

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
  userId: string,
  supplierId: string
): Promise<void> {
  await ensureSupplierOwnership(userId, supplierId);

  // Verify supplier exists
  const [existing] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId));

  if (!existing) {
    throw new Error("Supplier not found");
  }

  const [feedstockCount] = await db
    .select({ count: count() })
    .from(feedstocks)
    .where(eq(feedstocks.supplierId, supplierId));

  if (Number(feedstockCount.count) > 0) {
    throw new Error(
      "Cannot delete supplier with associated feedstock intakes. Remove intakes first."
    );
  }

  // Delete supplier locations first (FK constraint)
  await db.delete(supplierLocations).where(eq(supplierLocations.supplierId, supplierId));

  await db.delete(suppliers).where(eq(suppliers.id, supplierId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a supplier code is available
 */
export async function isSupplierCodeAvailable(
  userId: string,
  code: string,
  excludeSupplierId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(suppliers.code, code)];

  if (excludeSupplierId) {
    conditions.push(sql`${suppliers.id} != ${excludeSupplierId}`);
  }

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
export async function getSupplierLocations(userId: string): Promise<string[]> {
  requireAuth(userId);

  const results = await db
    .selectDistinct({ location: suppliers.location })
    .from(suppliers)
    .where(sql`${suppliers.location} IS NOT NULL AND ${suppliers.location} != ''`)
    .orderBy(asc(suppliers.location));

  return results.map((r) => r.location!).filter(Boolean);
}

/**
 * Get supplier options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getSupplierOptions(
  userId: string
): Promise<Array<{ id: string; code: string; name: string }>> {
  requireAuth(userId);

  return db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
    })
    .from(suppliers)
    .orderBy(asc(suppliers.name));
}

// ============================================
// Supplier Location Operations
// ============================================

export async function getSupplierLocationsBySupplier(
  userId: string,
  supplierId: string
): Promise<SupplierLocation[]> {
  requireAuth(userId);
  await ensureSupplierOwnership(userId, supplierId);

  return db
    .select()
    .from(supplierLocations)
    .where(eq(supplierLocations.supplierId, supplierId))
    .orderBy(asc(supplierLocations.country));
}

export async function getSupplierLocationById(
  userId: string,
  locationId: string
): Promise<SupplierLocation> {
  requireAuth(userId);
  await ensureSupplierLocationOwnership(userId, locationId);

  const [location] = await db
    .select()
    .from(supplierLocations)
    .where(eq(supplierLocations.id, locationId));

  if (!location) {
    throw new Error("Supplier location not found");
  }

  return location;
}

export async function createSupplierLocation(
  userId: string,
  data: {
    supplierId: string;
    name?: string | null;
    country: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    address?: string | null;
  }
): Promise<SupplierLocation> {
  requireAuth(userId);
  await ensureSupplierOwnership(userId, data.supplierId);

  const [location] = await db
    .insert(supplierLocations)
    .values({
      supplierId: data.supplierId,
      name: data.name ?? null,
      country: data.country,
      stateRegion: data.stateRegion ?? null,
      city: data.city ?? null,
      gpsLatitude: data.gpsLatitude ?? null,
      gpsLongitude: data.gpsLongitude ?? null,
      address: data.address ?? null,
    })
    .returning();

  return location;
}

export async function updateSupplierLocation(
  userId: string,
  locationId: string,
  data: {
    name?: string | null;
    country?: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    address?: string | null;
  }
): Promise<SupplierLocation> {
  requireAuth(userId);
  await ensureSupplierLocationOwnership(userId, locationId);

  const [updated] = await db
    .update(supplierLocations)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(supplierLocations.id, locationId))
    .returning();

  if (!updated) {
    throw new Error("Supplier location not found");
  }

  return updated;
}

export async function deleteSupplierLocation(
  userId: string,
  locationId: string
): Promise<void> {
  requireAuth(userId);
  await ensureSupplierLocationOwnership(userId, locationId);

  const deleted = await db.delete(supplierLocations).where(eq(supplierLocations.id, locationId)).returning({ id: supplierLocations.id });

  if (deleted.length === 0) {
    throw new Error("Supplier location not found");
  }
}
