/**
 * Storage Locations Data Access Layer
 * CRUD operations for storage locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  storageLocations,
  facilities,
  feedstocks,
  feedstockTypes,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
  deliveries,
  orders,
  applications,
  type StorageLocation,
} from "@/db/schema";
import {
  isFeedstockBinType,
  type StorageLocationFilterData,
  type StorageLocationType,
} from "@/schemas/storage-locations";

// ============================================
// Types
// ============================================

export interface StorageLocationLastActivity {
  type: "in" | "out";
  date: Date;
  massKg: number;
  label: string;
}

export interface StorageLocationWithFacility extends StorageLocation {
  facilityCode: string;
  facilityName: string;
  feedstockInventory: {
    batchCount: number;
    pendingBatchCount: number;
    feedstockTypes: string[];
    currentDryMassKg: number;
    pendingDryMassKg: number;
    estimatedWetMassKg: number | null;
    estimatedMoisturePercent: number | null;
  };
  biocharInventory: {
    productionRunCount: number;
    currentMassKg: number;
    allocatedToProductsKg: number;
    downstreamFormulations: string[];
  };
  productInventory: {
    batchCount: number;
    currentMassKg: number;
    biocharEquivalentKg: number;
    formulationNames: string[];
    appliedApplicationCount: number;
    appliedDryMassKg: number;
    lastAppliedAt: Date | null;
  };
  lastActivity: StorageLocationLastActivity | null;
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
import { SafeError } from "@/lib/errors";

type BaseStorageLocationRow = {
  id: string;
  code: string;
  name: string;
  type: StorageLocation["type"];
  capacityKg: number | null;
  storageMethod: string | null;
  storageDescription: string | null;
  supplierReferenceId: string | null;
  feedstockTypeId: string | null;
  formulationId: string | null;
  facilityId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  facilityCode: string | null;
  facilityName: string | null;
};

function splitAggregateLabels(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

async function enrichStorageLocationRows(
  rows: BaseStorageLocationRow[]
): Promise<StorageLocationWithFacility[]> {
  const storageLocationIds = rows.map((row) => row.id);
  const storageLocationIdsSql = sql.join(
    storageLocationIds.map((id) => sql`${id}`),
    sql`, `
  );

  // Run all enrichment queries in parallel
  const [
    feedstockInventoryRows,
    feedstockConsumptionRows,
    biocharOutputRows,
    biocharAllocationRows,
    productInventoryRows,
    productApplicationRows,
    lastActivityRows,
  ] = storageLocationIds.length > 0
    ? await Promise.all([
        db
          .select({
            storageLocationId: feedstocks.storageLocationId,
            batchCount: sql<number>`count(*) filter (where ${feedstocks.status} = 'complete')`,
            pendingBatchCount: sql<number>`count(*) filter (where ${feedstocks.status} = 'missing_data')`,
            feedstockTypes: sql<string | null>`
              string_agg(DISTINCT ${feedstockTypes.name}, ', ' ORDER BY ${feedstockTypes.name})
            `,
            totalDryKg: sql<number>`
              COALESCE(SUM(${feedstocks.massDryKg}) filter (where ${feedstocks.status} = 'complete'), 0)
            `,
            totalWetKg: sql<number>`
              COALESCE(SUM(${feedstocks.massWetKg}) filter (where ${feedstocks.status} = 'complete'), 0)
            `,
            pendingDryKg: sql<number>`
              COALESCE(SUM(${feedstocks.massDryKg}) filter (where ${feedstocks.status} = 'missing_data'), 0)
            `,
          })
          .from(feedstocks)
          .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
          .where(inArray(feedstocks.storageLocationId, storageLocationIds))
          .groupBy(feedstocks.storageLocationId),
        db
          .select({
            storageLocationId: productionRuns.feedstockStorageLocationId,
            consumedDryKg: sql<number>`COALESCE(SUM(${productionRunFeedstocks.massUsedKg}), 0)`,
          })
          .from(productionRuns)
          .leftJoin(
            productionRunFeedstocks,
            eq(productionRunFeedstocks.productionRunId, productionRuns.id)
          )
          .where(inArray(productionRuns.feedstockStorageLocationId, storageLocationIds))
          .groupBy(productionRuns.feedstockStorageLocationId),
        db
          .select({
            storageLocationId: productionRuns.biocharStorageLocationId,
            productionRunCount: count(),
            producedKg: sql<number>`COALESCE(SUM(${productionRuns.biocharOutputKg}), 0)`,
          })
          .from(productionRuns)
          .where(inArray(productionRuns.biocharStorageLocationId, storageLocationIds))
          .groupBy(productionRuns.biocharStorageLocationId),
        db
          .select({
            storageLocationId: productionRuns.biocharStorageLocationId,
            allocatedKg: sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
                ),
                0
              )
            `,
            downstreamFormulations: sql<string | null>`
              string_agg(DISTINCT ${formulations.name}, ', ' ORDER BY ${formulations.name})
            `,
          })
          .from(productionRuns)
          .innerJoin(
            biocharProducts,
            eq(biocharProducts.linkedProductionRunId, productionRuns.id)
          )
          .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
          .where(inArray(productionRuns.biocharStorageLocationId, storageLocationIds))
          .groupBy(productionRuns.biocharStorageLocationId),
        db
          .select({
            storageLocationId: biocharProducts.storageLocationId,
            batchCount: count(),
            currentMassKg: sql<number>`COALESCE(SUM(${biocharProducts.massKg}), 0)`,
            biocharEquivalentKg: sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${formulations.biocharRatio}, 1)
                ),
                0
              )
            `,
            formulationNames: sql<string | null>`
              string_agg(DISTINCT ${formulations.name}, ', ' ORDER BY ${formulations.name})
            `,
          })
          .from(biocharProducts)
          .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
          .where(inArray(biocharProducts.storageLocationId, storageLocationIds))
          .groupBy(biocharProducts.storageLocationId),
        db
          .select({
            storageLocationId: sql<string>`
              COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId})
            `,
            appliedApplicationCount: count(),
            appliedDryMassKg: sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${applications.biocharAppliedDryTons}, 0) * 1000
                ),
                0
              )
            `,
            lastAppliedAt: sql<Date | null>`MAX(${applications.applicationDate})`,
          })
          .from(applications)
          .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
          .leftJoin(orders, eq(deliveries.orderId, orders.id))
          .leftJoin(
            biocharProducts,
            sql`${biocharProducts.id} = COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`
          )
          .where(
            and(
              eq(applications.status, "applied"),
              sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId}) IS NOT NULL`,
              sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId}) IN (${storageLocationIdsSql})`
            )
          )
          .groupBy(
            sql`COALESCE(${deliveries.storageLocationId}, ${biocharProducts.storageLocationId})`
          ),
        db.execute<{
          storage_location_id: string;
          activity_type: "in" | "out";
          activity_date: Date;
          mass_kg: number | null;
          label: string;
        }>(sql`
          WITH events AS (
            SELECT storage_location_id, 'in' as activity_type, created_at, mass_dry_kg as mass_kg, code as label
            FROM feedstocks WHERE storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT
              pr.feedstock_storage_location_id,
              'out',
              pr.created_at,
              COALESCE(SUM(prf.mass_used_kg), pr.feedstock_mass_dry_kg, 0) as mass_kg,
              pr.code
            FROM production_runs pr
            LEFT JOIN production_run_feedstocks prf ON prf.production_run_id = pr.id
            WHERE pr.feedstock_storage_location_id IN (${storageLocationIdsSql})
            GROUP BY
              pr.id,
              pr.feedstock_storage_location_id,
              pr.created_at,
              pr.feedstock_mass_dry_kg,
              pr.code
            UNION ALL
            SELECT biochar_storage_location_id, 'in', created_at, biochar_output_kg, code
            FROM production_runs WHERE biochar_storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT pr.biochar_storage_location_id, 'out', bp.created_at, bp.mass_kg * COALESCE(f.biochar_ratio, 1), bp.code
            FROM biochar_products bp
            JOIN production_runs pr ON bp.linked_production_run_id = pr.id
            LEFT JOIN formulations f ON bp.formulation_id = f.id
            WHERE pr.biochar_storage_location_id IN (${storageLocationIdsSql})
            UNION ALL
            SELECT storage_location_id, 'in', created_at, mass_kg, code
            FROM biochar_products WHERE storage_location_id IN (${storageLocationIdsSql})
          )
          SELECT DISTINCT ON (storage_location_id)
            storage_location_id, activity_type, created_at as activity_date, mass_kg, label
          FROM events
          WHERE storage_location_id IS NOT NULL
          ORDER BY storage_location_id, created_at DESC
        `),
      ])
    : [
        [],
        [],
        [],
        [],
        [],
        [],
        {
          rows: [] as Array<{
            storage_location_id: string;
            activity_type: "in" | "out";
            activity_date: Date;
            mass_kg: number | null;
            label: string;
          }>,
        },
      ];

  const lastActivityMap = new Map(
    lastActivityRows.rows.map((row) => [
      row.storage_location_id,
      {
        type: row.activity_type,
        date: new Date(row.activity_date),
        massKg: Number(row.mass_kg ?? 0),
        label: row.label,
      },
    ])
  );

  const feedstockInventoryMap = new Map(
    feedstockInventoryRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const feedstockConsumptionMap = new Map(
    feedstockConsumptionRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const biocharOutputMap = new Map(
    biocharOutputRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const biocharAllocationMap = new Map(
    biocharAllocationRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const productInventoryMap = new Map(
    productInventoryRows.map((row) => [row.storageLocationId ?? "", row])
  );
  const productApplicationMap = new Map(
    productApplicationRows
      .filter((row) => row.storageLocationId != null)
      .map((row) => [row.storageLocationId, row])
  );

  return rows.map((row) => {
    const feedstockInventoryRow = feedstockInventoryMap.get(row.id);
    const feedstockConsumptionRow = feedstockConsumptionMap.get(row.id);
    const totalDryKg = Number(feedstockInventoryRow?.totalDryKg ?? 0);
    const totalWetKg = Number(feedstockInventoryRow?.totalWetKg ?? 0);
    const pendingDryKg = Number(feedstockInventoryRow?.pendingDryKg ?? 0);
    const consumedDryKg = Number(feedstockConsumptionRow?.consumedDryKg ?? 0);
    const currentDryMassKg = Math.max(0, totalDryKg - consumedDryKg);
    const moistureRatio =
      totalWetKg > 0 && totalDryKg >= 0
        ? Math.max(0, Math.min(1, (totalWetKg - totalDryKg) / totalWetKg))
        : null;
    const estimatedWetMassKg =
      moistureRatio != null && moistureRatio < 1
        ? currentDryMassKg / (1 - moistureRatio)
        : null;

    const biocharOutputRow = biocharOutputMap.get(row.id);
    const biocharAllocationRow = biocharAllocationMap.get(row.id);
    const producedKg = Number(biocharOutputRow?.producedKg ?? 0);
    const allocatedKg = Number(biocharAllocationRow?.allocatedKg ?? 0);

    const productInventoryRow = productInventoryMap.get(row.id);
    const productApplicationRow = productApplicationMap.get(row.id);

    return {
      ...row,
      facilityCode: row.facilityCode ?? "",
      facilityName: row.facilityName ?? "",
      feedstockInventory: {
        batchCount: Number(feedstockInventoryRow?.batchCount ?? 0),
        pendingBatchCount: Number(feedstockInventoryRow?.pendingBatchCount ?? 0),
        feedstockTypes: splitAggregateLabels(feedstockInventoryRow?.feedstockTypes ?? null),
        currentDryMassKg,
        pendingDryMassKg: pendingDryKg,
        estimatedWetMassKg,
        estimatedMoisturePercent:
          moistureRatio != null ? moistureRatio * 100 : null,
      },
      biocharInventory: {
        productionRunCount: Number(biocharOutputRow?.productionRunCount ?? 0),
        currentMassKg: Math.max(0, producedKg - allocatedKg),
        allocatedToProductsKg: allocatedKg,
        downstreamFormulations: splitAggregateLabels(
          biocharAllocationRow?.downstreamFormulations ?? null
        ),
      },
      productInventory: {
        batchCount: Number(productInventoryRow?.batchCount ?? 0),
        currentMassKg: Number(productInventoryRow?.currentMassKg ?? 0),
        biocharEquivalentKg: Number(productInventoryRow?.biocharEquivalentKg ?? 0),
        formulationNames: splitAggregateLabels(
          productInventoryRow?.formulationNames ?? null
        ),
        appliedApplicationCount: Number(
          productApplicationRow?.appliedApplicationCount ?? 0
        ),
        appliedDryMassKg: Number(productApplicationRow?.appliedDryMassKg ?? 0),
        lastAppliedAt: productApplicationRow?.lastAppliedAt
          ? new Date(productApplicationRow.lastAppliedAt)
          : null,
      },
      lastActivity: lastActivityMap.get(row.id) ?? null,
    };
  });
}

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

  const items = await enrichStorageLocationRows(storageLocationList);

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

  const [enriched] = await enrichStorageLocationRows([result]);

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
    .where(isNull(storageLocations.archivedAt))
    .orderBy(asc(storageLocations.type));

  return results.map((r) => r.type);
}
