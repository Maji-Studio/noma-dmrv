/**
 * Facilities Data Access Layer
 * CRUD operations for facilities with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  facilities,
  reactors,
  storageLocations,
  type Facility,
} from "@/db/schema";
import type { FacilityFilterData } from "@/schemas/facilities";

// ============================================
// Types
// ============================================

export interface FacilityWithRelations extends Facility {
  reactorCount: number;
  storageLocationCount: number;
}

export interface PaginatedFacilities {
  items: FacilityWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FacilityDetail extends Facility {
  reactors: Array<{
    id: string;
    code: string;
    identifier: string;
    type: string;
    reactorType: string;
  }>;
  storageLocations: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
  }>;
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
// Read Operations
// ============================================

/**
 * Get all facilities with pagination and filtering
 * Supports search, country filter, sorting, and pagination
 */
export async function getFacilities(
  userId: string,
  filters?: Partial<FacilityFilterData>
): Promise<PaginatedFacilities> {
  requireAuth(userId);

  const {
    search,
    country,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(facilities.code, searchPattern),
        ilike(facilities.name, searchPattern),
        ilike(facilities.location, searchPattern),
        ilike(facilities.country, searchPattern)
      )!
    );
  }

  if (country) {
    conditions.push(ilike(facilities.country, country));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: facilities.code,
    name: facilities.name,
    country: facilities.country,
    location: facilities.location,
    createdAt: facilities.createdAt,
    updatedAt: facilities.updatedAt,
  }[sortBy] ?? facilities.name;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(facilities)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get facilities with reactor and storage location counts
  const facilityList = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      location: facilities.location,
      gpsLatitude: facilities.gpsLatitude,
      gpsLongitude: facilities.gpsLongitude,
      country: facilities.country,
      address: facilities.address,
      contactEmail: facilities.contactEmail,
      contactPhone: facilities.contactPhone,
      defaultDurabilityOption: facilities.defaultDurabilityOption,
      createdAt: facilities.createdAt,
      updatedAt: facilities.updatedAt,
    })
    .from(facilities)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Get counts for each facility
  const facilityIds = facilityList.map((f) => f.id);

  // Get reactor counts
  const reactorCounts =
    facilityIds.length > 0
      ? await db
          .select({
            facilityId: reactors.facilityId,
            count: count(),
          })
          .from(reactors)
          .where(inArray(reactors.facilityId, facilityIds))
          .groupBy(reactors.facilityId)
      : [];

  // Get storage location counts
  const storageCounts =
    facilityIds.length > 0
      ? await db
          .select({
            facilityId: storageLocations.facilityId,
            count: count(),
          })
          .from(storageLocations)
          .where(inArray(storageLocations.facilityId, facilityIds))
          .groupBy(storageLocations.facilityId)
      : [];

  // Create maps for quick lookup
  const reactorCountMap = new Map(
    reactorCounts.map((r) => [r.facilityId, Number(r.count)])
  );
  const storageCountMap = new Map(
    storageCounts.map((s) => [s.facilityId, Number(s.count)])
  );

  // Combine data
  const items: FacilityWithRelations[] = facilityList.map((f) => ({
    ...f,
    reactorCount: reactorCountMap.get(f.id) ?? 0,
    storageLocationCount: storageCountMap.get(f.id) ?? 0,
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
 * Get a single facility by ID
 * Returns facility data without relations
 */
export async function getFacilityById(
  userId: string,
  facilityId: string
): Promise<Facility> {
  requireAuth(userId);

  const [facility] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, facilityId));

  if (!facility) {
    throw new Error("Facility not found");
  }

  return facility;
}

/**
 * Get a single facility with all its relationships
 * Includes reactors and storage locations
 */
export async function getFacilityWithRelations(
  userId: string,
  facilityId: string
): Promise<FacilityDetail> {
  requireAuth(userId);

  // Get facility
  const [facility] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, facilityId));

  if (!facility) {
    throw new Error("Facility not found");
  }

  // Get associated reactors
  const facilityReactors = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      type: reactors.type,
      reactorType: reactors.reactorType,
    })
    .from(reactors)
    .where(eq(reactors.facilityId, facilityId))
    .orderBy(asc(reactors.code));

  // Get associated storage locations
  const facilityStorageLocations = await db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
    })
    .from(storageLocations)
    .where(eq(storageLocations.facilityId, facilityId))
    .orderBy(asc(storageLocations.code));

  return {
    ...facility,
    reactors: facilityReactors,
    storageLocations: facilityStorageLocations,
  };
}

/**
 * Get reactors associated with a facility
 */
export async function getFacilityReactors(
  userId: string,
  facilityId: string
): Promise<
  Array<{
    id: string;
    code: string;
    identifier: string;
    type: string;
    reactorType: string;
    capacityKg: number | null;
    samplingMethod: string;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
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
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      type: reactors.type,
      reactorType: reactors.reactorType,
      capacityKg: reactors.capacityKg,
      samplingMethod: reactors.samplingMethod,
      createdAt: reactors.createdAt,
      updatedAt: reactors.updatedAt,
    })
    .from(reactors)
    .where(eq(reactors.facilityId, facilityId))
    .orderBy(asc(reactors.code));
}

/**
 * Get storage locations associated with a facility
 */
export async function getFacilityStorageLocations(
  userId: string,
  facilityId: string
): Promise<
  Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    capacityKg: number | null;
    latitude: number | null;
    longitude: number | null;
    storageMethod: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
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
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      capacityKg: storageLocations.capacityKg,
      latitude: storageLocations.latitude,
      longitude: storageLocations.longitude,
      storageMethod: storageLocations.storageMethod,
      createdAt: storageLocations.createdAt,
      updatedAt: storageLocations.updatedAt,
    })
    .from(storageLocations)
    .where(eq(storageLocations.facilityId, facilityId))
    .orderBy(asc(storageLocations.code));
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new facility
 */
export async function createFacility(
  userId: string,
  data: {
    code: string;
    name: string;
    country: string;
    location?: string | null;
    address?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    defaultDurabilityOption?: "200_year" | "1000_year";
  }
): Promise<Facility> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.code, data.code));

  if (existing) {
    throw new Error("A facility with this code already exists");
  }

  const [facility] = await db
    .insert(facilities)
    .values({
      code: data.code,
      name: data.name,
      country: data.country,
      location: data.location ?? null,
      address: data.address ?? null,
      gpsLatitude: data.gpsLatitude ?? null,
      gpsLongitude: data.gpsLongitude ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      defaultDurabilityOption: data.defaultDurabilityOption ?? "200_year",
    })
    .returning();

  return facility;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing facility
 */
export async function updateFacility(
  userId: string,
  facilityId: string,
  data: {
    code?: string;
    name?: string;
    country?: string;
    location?: string | null;
    address?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    defaultDurabilityOption?: "200_year" | "1000_year";
  }
): Promise<Facility> {
  requireAuth(userId);

  // Verify facility exists
  const [existing] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, facilityId));

  if (!existing) {
    throw new Error("Facility not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.code, data.code));

    if (duplicate) {
      throw new Error("A facility with this code already exists");
    }
  }

  const [updated] = await db
    .update(facilities)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(facilities.id, facilityId))
    .returning();

  return updated;
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a facility
 * Will fail if facility has associated reactors or storage locations
 */
export async function deleteFacility(
  userId: string,
  facilityId: string
): Promise<void> {
  requireAuth(userId);

  // Verify facility exists
  const [existing] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, facilityId));

  if (!existing) {
    throw new Error("Facility not found");
  }

  // Check for associated reactors
  const [reactorCount] = await db
    .select({ count: count() })
    .from(reactors)
    .where(eq(reactors.facilityId, facilityId));

  if (Number(reactorCount.count) > 0) {
    throw new Error(
      "Cannot delete facility with associated reactors. Remove reactors first."
    );
  }

  // Check for associated storage locations
  const [storageCount] = await db
    .select({ count: count() })
    .from(storageLocations)
    .where(eq(storageLocations.facilityId, facilityId));

  if (Number(storageCount.count) > 0) {
    throw new Error(
      "Cannot delete facility with associated storage locations. Remove storage locations first."
    );
  }

  await db.delete(facilities).where(eq(facilities.id, facilityId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a facility code is available
 */
export async function isFacilityCodeAvailable(
  userId: string,
  code: string,
  excludeFacilityId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(facilities.code, code)];

  if (excludeFacilityId) {
    conditions.push(sql`${facilities.id} != ${excludeFacilityId}`);
  }

  const [existing] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get unique countries from all facilities
 * Useful for filter dropdowns
 */
export async function getFacilityCountries(userId: string): Promise<string[]> {
  requireAuth(userId);

  const results = await db
    .selectDistinct({ country: facilities.country })
    .from(facilities)
    .orderBy(asc(facilities.country));

  return results.map((r) => r.country);
}
