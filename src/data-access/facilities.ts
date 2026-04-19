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
  feedstocks,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
  stockpileEvents,
  powerProcurementEvidence,
  type Facility,
} from "@/db/schema";
import type { FacilityFilterData } from "@/schemas/facilities";

// ============================================
// Types
// ============================================

export interface FacilityWithRelations extends Facility {
  reactorCount: number;
  storageLocationCount: number;
  reactorPreview: Array<{
    id: string;
    code: string;
    identifier: string;
    reactorType: string;
  }>;
  storageSummary: {
    feedstockBinCount: number;
    biocharBinCount: number;
    productBinCount: number;
  };
  inventorySummary: {
    feedstockDryKg: number;
    biocharKg: number;
    productKg: number;
  };
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

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";

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
      timezone: facilities.timezone,
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

  // Run all enrichment queries in parallel
  const [
    reactorPreviewRows,
    storageCountsByType,
    feedstockInventoryRows,
    feedstockConsumptionRows,
    biocharOutputRows,
    biocharAllocationRows,
    productInventoryRows,
  ] = facilityIds.length > 0
    ? await Promise.all([
        db
          .select({
            id: reactors.id,
            facilityId: reactors.facilityId,
            code: reactors.code,
            identifier: reactors.identifier,
            reactorType: reactors.reactorType,
          })
          .from(reactors)
          .where(inArray(reactors.facilityId, facilityIds))
          .orderBy(asc(reactors.facilityId), asc(reactors.code)),
        db
          .select({
            facilityId: storageLocations.facilityId,
            type: storageLocations.type,
            count: count(),
          })
          .from(storageLocations)
          .where(inArray(storageLocations.facilityId, facilityIds))
          .groupBy(storageLocations.facilityId, storageLocations.type),
        db
          .select({
            facilityId: feedstocks.facilityId,
            totalDryKg: sql<number>`COALESCE(SUM(${feedstocks.massDryKg}), 0)`,
          })
          .from(feedstocks)
          .where(inArray(feedstocks.facilityId, facilityIds))
          .groupBy(feedstocks.facilityId),
        db
          .select({
            facilityId: productionRuns.facilityId,
            totalConsumedKg: sql<number>`COALESCE(SUM(${productionRunFeedstocks.massUsedKg}), 0)`,
          })
          .from(productionRuns)
          .leftJoin(
            productionRunFeedstocks,
            eq(productionRunFeedstocks.productionRunId, productionRuns.id)
          )
          .where(inArray(productionRuns.facilityId, facilityIds))
          .groupBy(productionRuns.facilityId),
        db
          .select({
            facilityId: productionRuns.facilityId,
            totalProducedKg: sql<number>`COALESCE(SUM(${productionRuns.biocharOutputKg}), 0)`,
          })
          .from(productionRuns)
          .where(inArray(productionRuns.facilityId, facilityIds))
          .groupBy(productionRuns.facilityId),
        db
          .select({
            facilityId: biocharProducts.facilityId,
            totalAllocatedKg: sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
                ),
                0
              )
            `,
          })
          .from(biocharProducts)
          .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
          .where(inArray(biocharProducts.facilityId, facilityIds))
          .groupBy(biocharProducts.facilityId),
        db
          .select({
            facilityId: biocharProducts.facilityId,
            totalProductKg: sql<number>`COALESCE(SUM(${biocharProducts.massKg}), 0)`,
          })
          .from(biocharProducts)
          .where(inArray(biocharProducts.facilityId, facilityIds))
          .groupBy(biocharProducts.facilityId),
      ])
    : [[], [], [], [], [], [], []];

  // Derive reactor counts and preview (max 4) from preview rows
  const reactorCountMap = new Map<string, number>();
  const reactorPreviewMap = new Map<
    string,
    Array<{ id: string; code: string; identifier: string; reactorType: string }>
  >();
  for (const reactor of reactorPreviewRows) {
    reactorCountMap.set(reactor.facilityId, (reactorCountMap.get(reactor.facilityId) ?? 0) + 1);
    const existing = reactorPreviewMap.get(reactor.facilityId) ?? [];
    if (existing.length < 4) {
      existing.push({
        id: reactor.id,
        code: reactor.code,
        identifier: reactor.identifier,
        reactorType: reactor.reactorType,
      });
      reactorPreviewMap.set(reactor.facilityId, existing);
    }
  }

  const storageSummaryMap = new Map<
    string,
    { feedstockBinCount: number; biocharBinCount: number; productBinCount: number }
  >();
  for (const row of storageCountsByType) {
    const summary = storageSummaryMap.get(row.facilityId) ?? {
      feedstockBinCount: 0,
      biocharBinCount: 0,
      productBinCount: 0,
    };

    if (row.type === "feedstock_bin") {
      summary.feedstockBinCount = Number(row.count);
    } else if (row.type === "biochar_bin") {
      summary.biocharBinCount = Number(row.count);
    } else if (row.type === "product_bin") {
      summary.productBinCount = Number(row.count);
    }

    storageSummaryMap.set(row.facilityId, summary);
  }

  const feedstockInventoryMap = new Map(
    feedstockInventoryRows.map((row) => [row.facilityId, Number(row.totalDryKg)])
  );
  const feedstockConsumptionMap = new Map(
    feedstockConsumptionRows.map((row) => [row.facilityId, Number(row.totalConsumedKg)])
  );
  const biocharOutputMap = new Map(
    biocharOutputRows.map((row) => [row.facilityId, Number(row.totalProducedKg)])
  );
  const biocharAllocationMap = new Map(
    biocharAllocationRows.map((row) => [row.facilityId, Number(row.totalAllocatedKg)])
  );
  const productInventoryMap = new Map(
    productInventoryRows.map((row) => [row.facilityId, Number(row.totalProductKg)])
  );

  // Combine data
  const items: FacilityWithRelations[] = facilityList.map((f) => ({
    ...f,
    reactorCount: reactorCountMap.get(f.id) ?? 0,
    storageLocationCount:
      (storageSummaryMap.get(f.id)?.feedstockBinCount ?? 0) +
      (storageSummaryMap.get(f.id)?.biocharBinCount ?? 0) +
      (storageSummaryMap.get(f.id)?.productBinCount ?? 0),
    reactorPreview: reactorPreviewMap.get(f.id) ?? [],
    storageSummary: storageSummaryMap.get(f.id) ?? {
      feedstockBinCount: 0,
      biocharBinCount: 0,
      productBinCount: 0,
    },
    inventorySummary: {
      feedstockDryKg: Math.max(
        0,
        (feedstockInventoryMap.get(f.id) ?? 0) -
          (feedstockConsumptionMap.get(f.id) ?? 0)
      ),
      biocharKg: Math.max(
        0,
        (biocharOutputMap.get(f.id) ?? 0) -
          (biocharAllocationMap.get(f.id) ?? 0)
      ),
      productKg: productInventoryMap.get(f.id) ?? 0,
    },
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
    throw new SafeError("Facility not found");
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
    throw new SafeError("Facility not found");
  }

  // Get associated reactors
  const facilityReactors = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
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
    reactorType: string;
    nominalThroughputTph: number | null;
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
    throw new SafeError("Facility not found");
  }

  return db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      reactorType: reactors.reactorType,
      nominalThroughputTph: reactors.nominalThroughputTph,
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
    throw new SafeError("Facility not found");
  }

  return db
    .select({
      id: storageLocations.id,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      capacityKg: storageLocations.capacityKg,
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
    timezone?: string | null;
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
    throw new SafeError("A facility with this code already exists");
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
      timezone: data.timezone ?? null,
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
    timezone?: string | null;
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
    throw new SafeError("Facility not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.code, data.code));

    if (duplicate) {
      throw new SafeError("A facility with this code already exists");
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
    throw new SafeError("Facility not found");
  }

  const [[reactorCount], [storageCount], [stockpileCount], [powerCount]] =
    await Promise.all([
      db.select({ count: count() }).from(reactors).where(eq(reactors.facilityId, facilityId)),
      db.select({ count: count() }).from(storageLocations).where(eq(storageLocations.facilityId, facilityId)),
      db.select({ count: count() }).from(stockpileEvents).where(eq(stockpileEvents.facilityId, facilityId)),
      db.select({ count: count() }).from(powerProcurementEvidence).where(eq(powerProcurementEvidence.facilityId, facilityId)),
    ]);

  if (Number(reactorCount.count) > 0) {
    throw new SafeError(
      "Cannot delete facility with associated reactors. Remove reactors first."
    );
  }
  if (Number(storageCount.count) > 0) {
    throw new SafeError(
      "Cannot delete facility with associated storage locations. Remove storage locations first."
    );
  }
  if (Number(stockpileCount.count) > 0) {
    throw new SafeError(
      "Cannot delete facility with associated stockpile events. Remove stockpile events first."
    );
  }
  if (Number(powerCount.count) > 0) {
    throw new SafeError(
      "Cannot delete facility with associated power procurement evidence. Remove power procurement evidence first."
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
