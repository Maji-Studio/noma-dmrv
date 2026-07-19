/**
 * Feedstock Data Access Layer
 * Unified CRUD for the combined delivery + bin allocation workflow.
 * Each feedstock record contains both delivery info and bin allocation.
 * Split deliveries (one truck → multiple bins) share a deliveryGroupId.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, SQL } from "drizzle-orm";
import { db } from "@/db";
import { countRows, sumNumeric } from "@/db/aggregate";
import {
  feedstocks,
  feedstockTypes,
  facilities,
  storageLocations,
  supplierLocations,
  suppliers,
  vehicles,
  productionRunFeedstocks,
} from "@/db/schema";
import type { FeedstockFilterData } from "@/schemas/feedstocks";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { deriveTransportLeg, positiveOrNull } from "@/lib/calculations/transport-leg";
import {
  deleteTransportLegsForEntity,
  replaceDerivedTransportLeg,
} from "./transport-legs";
import { SafeError } from "@/lib/errors";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { lockBinStocks } from "./lock-bin-stocks";

const FEEDSTOCK_INTAKE_BIN_TYPES = ["feedstock_bin"] as const;

function isFeedstockIntakeBinType(type: string): boolean {
  return FEEDSTOCK_INTAKE_BIN_TYPES.some((binType) => binType === type);
}

// ============================================
// Types
// ============================================

export interface FeedstockWithRelations {
  id: string;
  code: string;
  facilityId: string;
  status: "missing_data" | "complete";
  // Delivery fields
  deliveryDate: Date | null;
  supplierId: string | null;
  vehicleId: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  deliveryGroupId: string | null;
  overrideJustification: string | null;
  // Material fields
  feedstockTypeId: string;
  massDryKg: number;
  massWetKg: number | null;
  moistureContentPercent: number | null;
  storageLocationId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined relations
  facilityName: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  vehiclePlateNumber: string | null;
  feedstockTypeName: string | null;
  feedstockTypeCategory: string | null;
  storageLocationName: string | null;
  storageLocationCode: string | null;
}

export interface PaginatedFeedstocks {
  items: FeedstockWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FeedstockStats {
  totalFeedstocks: number;
  totalDryMassKg: number;
  avgMoisturePercent: number | null;
  completeFeedstocks: number;
  missingDataFeedstocks: number;
}

export interface CreateFeedstockAllocation {
  storageLocationId: string;
  allocatedWetMassKg: number;
}

export interface CreateFeedstockInput {
  facilityId: string;
  deliveryDate: Date;
  supplierId: string;
  vehicleId?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  feedstockTypeId: string;
  totalWetMassKg: number;
  moisturePercent: number;
  allocations: CreateFeedstockAllocation[];
  overrideJustification?: string | null;
  notes?: string | null;
}

export interface CreateFeedstockResult {
  feedstocks: FeedstockWithRelations[];
  warning: string | null;
}

// ============================================
// Select fields
// ============================================

const feedstockSelectFields = {
  id: feedstocks.id,
  code: feedstocks.code,
  facilityId: feedstocks.facilityId,
  status: feedstocks.status,
  deliveryDate: feedstocks.deliveryDate,
  supplierId: feedstocks.supplierId,
  vehicleId: feedstocks.vehicleId,
  gpsLatitude: feedstocks.gpsLatitude,
  gpsLongitude: feedstocks.gpsLongitude,
  deliveryGroupId: feedstocks.deliveryGroupId,
  overrideJustification: feedstocks.overrideJustification,
  feedstockTypeId: feedstocks.feedstockTypeId,
  massDryKg: feedstocks.massDryKg,
  massWetKg: feedstocks.massWetKg,
  moistureContentPercent: feedstocks.moistureContentPercent,
  storageLocationId: feedstocks.storageLocationId,
  notes: feedstocks.notes,
  createdAt: feedstocks.createdAt,
  updatedAt: feedstocks.updatedAt,
  // Relations
  facilityName: facilities.name,
  supplierName: suppliers.name,
  supplierCode: suppliers.code,
  vehiclePlateNumber: vehicles.name,
  feedstockTypeName: feedstockTypes.name,
  feedstockTypeCategory: feedstockTypes.category,
  storageLocationName: storageLocations.name,
  storageLocationCode: storageLocations.code,
} as const;

function feedstockBaseQuery(ctx: OrgContext) {
  return db
    .select(feedstockSelectFields)
    .from(feedstocks)
    .leftJoin(facilities, and(eq(feedstocks.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
    .leftJoin(vehicles, and(eq(feedstocks.vehicleId, vehicles.id), eq(vehicles.organizationId, ctx.organizationId)))
    .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(feedstocks.storageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)));
}

// ============================================
// Read Operations
// ============================================

export async function getFeedstocks(
  ctx: OrgContext,
  filters?: Partial<FeedstockFilterData>
): Promise<PaginatedFeedstocks> {
  requireOrgScope(ctx);

  const {
    search,
    facilityId,
    supplierId,
    feedstockTypeId,
    status,
    storageLocationId,
    startDate,
    endDate,
    page = 1,
    pageSize = 20,
    sortBy = "deliveryDate",
    sortOrder = "desc",
  } = filters ?? {};

  // Archived feedstocks (facility archive cascade) are hidden
  const conditions: SQL[] = [
    eq(feedstocks.organizationId, ctx.organizationId),
    isNull(feedstocks.archivedAt),
  ];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(feedstocks.code, searchPattern),
        ilike(suppliers.name, searchPattern),
        ilike(suppliers.code, searchPattern),
        ilike(feedstockTypes.name, searchPattern),
        ilike(storageLocations.name, searchPattern)
      )!
    );
  }

  if (facilityId) conditions.push(eq(feedstocks.facilityId, facilityId));
  if (supplierId) conditions.push(eq(feedstocks.supplierId, supplierId));
  if (feedstockTypeId) conditions.push(eq(feedstocks.feedstockTypeId, feedstockTypeId));
  if (status) conditions.push(eq(feedstocks.status, status));
  if (storageLocationId) conditions.push(eq(feedstocks.storageLocationId, storageLocationId));
  if (startDate) {
    const startOfDay = new Date(startDate);
    startOfDay.setHours(0, 0, 0, 0);
    conditions.push(gte(feedstocks.deliveryDate, startOfDay));
  }
  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(lte(feedstocks.deliveryDate, endOfDay));
  }

  const whereClause = and(...conditions);

  const sortColumn = {
    code: feedstocks.code,
    deliveryDate: feedstocks.deliveryDate,
    massDryKg: feedstocks.massDryKg,
    massWetKg: feedstocks.massWetKg,
    createdAt: feedstocks.createdAt,
    updatedAt: feedstocks.updatedAt,
  }[sortBy] ?? feedstocks.deliveryDate;

  const orderFn = sortOrder === "asc" ? asc : desc;

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(feedstocks)
    .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
    .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(feedstocks.storageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  const items = await feedstockBaseQuery(ctx)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  return { items, total, page, pageSize, totalPages };
}

export async function getFeedstockById(
  ctx: OrgContext,
  feedstockId: string
): Promise<FeedstockWithRelations> {
  requireOrgScope(ctx);

  const [item] = await feedstockBaseQuery(ctx).where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!item) {
    throw new SafeError("Feedstock not found");
  }

  return item;
}

export async function getFeedstockStats(
  ctx: OrgContext,
  facilityId?: string
): Promise<FeedstockStats> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(feedstocks.organizationId, ctx.organizationId),
    isNull(feedstocks.archivedAt),
  ];
  if (facilityId) conditions.push(eq(feedstocks.facilityId, facilityId));
  const whereClause = and(...conditions);

  // org-scope-ok: whereClause includes the active organization predicate.
  const [stats] = await db
    .select({
      totalFeedstocks: count(),
      totalDryMassKg: sumNumeric(feedstocks.massDryKg),
      avgMoisturePercent: sql<number | null>`case when sum(case when ${feedstocks.moistureContentPercent} is not null then ${feedstocks.massWetKg} end) > 0 then sum(case when ${feedstocks.moistureContentPercent} is not null then ${feedstocks.moistureContentPercent} * ${feedstocks.massWetKg} end) / sum(case when ${feedstocks.moistureContentPercent} is not null then ${feedstocks.massWetKg} end) else null end`,
      completeFeedstocks: countRows(sql`${feedstocks.status} = 'complete'`),
      missingDataFeedstocks: countRows(
        sql`${feedstocks.status} = 'missing_data'`,
      ),
    })
    .from(feedstocks)
    .where(whereClause);

  return {
    totalFeedstocks: Number(stats.totalFeedstocks),
    totalDryMassKg: stats.totalDryMassKg,
    avgMoisturePercent: stats.avgMoisturePercent != null ? Number(stats.avgMoisturePercent) : null,
    completeFeedstocks: stats.completeFeedstocks,
    missingDataFeedstocks: stats.missingDataFeedstocks,
  };
}

// ============================================
// Create Operations
// ============================================

export async function createFeedstock(
  ctx: OrgContext,
  data: CreateFeedstockInput,
  codesFn: (count: number) => Promise<string[]>
): Promise<CreateFeedstockResult> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, feedstockTypes, data.feedstockTypeId);
  await assertSameOrg(ctx, suppliers, data.supplierId);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId);
  await Promise.all(
    data.allocations.map((allocation) =>
      assertSameOrg(ctx, storageLocations, allocation.storageLocationId),
    ),
  );

  const allocatedTotalWetKg = data.allocations.reduce((sum, a) => sum + a.allocatedWetMassKg, 0);
  const deliveryGroupId = data.allocations.length > 1 ? crypto.randomUUID() : null;

  // Confirm the feedstock type exists before locking compatible bins to it.
  const [feedstockType] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

  if (!feedstockType) {
    throw new SafeError("Feedstock type not found");
  }

  // Batch-validate bin type compatibility for all allocations
  const binIds = data.allocations.map((a) => a.storageLocationId);
  const bins = await db
    .select({
      id: storageLocations.id,
      type: storageLocations.type,
      feedstockTypeId: storageLocations.feedstockTypeId,
      facilityId: storageLocations.facilityId,
    })
    .from(storageLocations)
    .where(and(inArray(storageLocations.id, binIds), eq(storageLocations.organizationId, ctx.organizationId)));

  const binMap = new Map(bins.map((b) => [b.id, b]));
  for (const allocation of data.allocations) {
    const bin = binMap.get(allocation.storageLocationId);
    if (!bin) {
      throw new SafeError(`Storage bin not found: ${allocation.storageLocationId}`);
    }
    if (bin.facilityId !== data.facilityId) {
      throw new SafeError(`Storage bin ${bin.id} does not belong to the selected facility`);
    }
      if (!isFeedstockIntakeBinType(bin.type)) {
        throw new SafeError(
          `Feedstock materials must be allocated to a feedstock bin, not a ${bin.type.replace("_", " ")}.`
        );
      }
    if (bin.feedstockTypeId && bin.feedstockTypeId !== data.feedstockTypeId) {
      throw new SafeError(
        `Storage bin already holds a different feedstock type. Each bin can only hold one type.`
      );
    }
  }

  const codes = await codesFn(data.allocations.length);
  const stockBinIds = data.allocations
    .filter((allocation) =>
      deriveMassDryKg(allocation.allocatedWetMassKg, data.moisturePercent) > 0
    )
    .map((allocation) => allocation.storageLocationId);

  const createdFeedstocks = await db.transaction(async (tx) => {
    await lockBinStocks(ctx, tx, stockBinIds);
    const results: string[] = [];

    for (let i = 0; i < data.allocations.length; i++) {
      const allocation = data.allocations[i];
      const allocatedDryMassKg = deriveMassDryKg(allocation.allocatedWetMassKg, data.moisturePercent);

      const status = determineFeedstockStatus({
        feedstockTypeId: data.feedstockTypeId,
        massDryKg: allocatedDryMassKg,
      });

      const [feedstock] = await tx
        .insert(feedstocks)
        .values({
          organizationId: ctx.organizationId,
          code: codes[i],
          facilityId: data.facilityId,
          status,
          // Delivery fields
          deliveryDate: data.deliveryDate,
          supplierId: data.supplierId,
          vehicleId: data.vehicleId ?? null,
          gpsLatitude: data.gpsLatitude ?? null,
          gpsLongitude: data.gpsLongitude ?? null,
          deliveryGroupId,
          overrideJustification: data.overrideJustification || null,
          // Material fields
          feedstockTypeId: data.feedstockTypeId,
          massDryKg: allocatedDryMassKg,
          massWetKg: allocation.allocatedWetMassKg,
          moistureContentPercent: data.moisturePercent,
          storageLocationId: allocation.storageLocationId,
          notes: data.notes || null,
        })
        .returning({ id: feedstocks.id });

      results.push(feedstock.id);

      // Lock feedstock type on bin (first-use lock)
      await tx
        .update(storageLocations)
        .set({ feedstockTypeId: data.feedstockTypeId })
        .where(
          and(
            eq(storageLocations.id, allocation.storageLocationId),
            eq(storageLocations.organizationId, ctx.organizationId),
            sql`${storageLocations.feedstockTypeId} is null`
          )
        );
    }

    return results;
  });

  // Fetch the created records with relations in one query
  const items = await feedstockBaseQuery(ctx)
    .where(and(inArray(feedstocks.id, createdFeedstocks), eq(feedstocks.organizationId, ctx.organizationId)));

  // Generate warning if allocated wet mass > total delivery wet mass
  let warning: string | null = null;
  if (allocatedTotalWetKg > data.totalWetMassKg) {
    warning = `Allocated wet mass (${allocatedTotalWetKg.toFixed(1)} kg) exceeds total delivery wet mass (${data.totalWetMassKg.toFixed(1)} kg).`;
  }

  return { feedstocks: items, warning };
}

// ============================================
// Update Operations
// ============================================

export async function updateFeedstock(
  ctx: OrgContext,
  feedstockId: string,
  data: {
    facilityId?: string;
    deliveryDate?: Date;
    supplierId?: string;
    vehicleId?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    feedstockTypeId?: string;
    massDryKg?: number;
    massWetKg?: number | null;
    moistureContentPercent?: number | null;
    storageLocationId?: string | null;
    overrideJustification?: string | null;
    notes?: string | null;
  }
): Promise<FeedstockWithRelations> {
  requireOrgScope(ctx);
  if (data.supplierId) await assertSameOrg(ctx, suppliers, data.supplierId);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId);
  if (data.feedstockTypeId) await assertSameOrg(ctx, feedstockTypes, data.feedstockTypeId);
  if (data.storageLocationId) await assertSameOrg(ctx, storageLocations, data.storageLocationId);

  const [existing] = await db
    .select()
    .from(feedstocks)
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Feedstock not found");
  }

  // Validate storage bin compatibility if changing storage location or feedstock type
  if (data.storageLocationId || data.feedstockTypeId) {
    const binId = data.storageLocationId ?? existing.storageLocationId;
    const typeId = data.feedstockTypeId ?? existing.feedstockTypeId;
    const facId = data.facilityId ?? existing.facilityId;

    // Confirm the feedstock type exists before validating compatible bins.
    const [ft] = await db
      .select({ id: feedstockTypes.id })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, typeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

    if (!ft) {
      throw new SafeError("Feedstock type not found");
    }

    if (binId) {
      const [bin] = await db
        .select({
          type: storageLocations.type,
          feedstockTypeId: storageLocations.feedstockTypeId,
          facilityId: storageLocations.facilityId,
        })
        .from(storageLocations)
        .where(and(eq(storageLocations.id, binId), eq(storageLocations.organizationId, ctx.organizationId)));

      if (!bin) {
        throw new SafeError(`Storage bin not found: ${binId}`);
      }
      if (bin.facilityId !== facId) {
        throw new SafeError(`Storage bin ${binId} does not belong to the selected facility`);
      }

      if (!isFeedstockIntakeBinType(bin.type)) {
        throw new SafeError(
          "Feedstock materials must be allocated to a feedstock bin."
        );
      }
      if (bin.feedstockTypeId && bin.feedstockTypeId !== typeId) {
        throw new SafeError(
          "Storage bin already holds a different feedstock type. Each bin can only hold one type."
        );
      }
    }
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(feedstocks)
      .where(and(
        eq(feedstocks.id, feedstockId),
        eq(feedstocks.organizationId, ctx.organizationId),
      ))
      .for("update");

    if (!locked) {
      throw new SafeError("Feedstock not found");
    }

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "feedstock", entityId: feedstockId },
      "update",
    );

    const status = determineFeedstockStatus({ ...locked, ...data });
    const effectiveStorageLocationId =
      data.storageLocationId !== undefined
        ? data.storageLocationId
        : locked.storageLocationId;
    const stockDerivationChanged =
      status !== locked.status ||
      (data.massDryKg !== undefined && data.massDryKg !== locked.massDryKg) ||
      (data.storageLocationId !== undefined &&
        data.storageLocationId !== locked.storageLocationId);

    if (stockDerivationChanged) {
      await lockBinStocks(ctx, tx, [
        locked.storageLocationId,
        effectiveStorageLocationId,
      ]);
    }

    await tx
      .update(feedstocks)
      .set({
        ...data,
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));
  });

  return getFeedstockById(ctx, feedstockId);
}

// ============================================
// Delete Operations
// ============================================

export async function deleteFeedstock(
  ctx: OrgContext,
  feedstockId: string
): Promise<void> {
  requireOrgScope(ctx);

  const [existing] = await db
    .select({
      id: feedstocks.id,
      status: feedstocks.status,
      storageLocationId: feedstocks.storageLocationId,
    })
    .from(feedstocks)
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Feedstock not found");
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: feedstocks.id,
        status: feedstocks.status,
        storageLocationId: feedstocks.storageLocationId,
      })
      .from(feedstocks)
      .where(and(
        eq(feedstocks.id, feedstockId),
        eq(feedstocks.organizationId, ctx.organizationId),
      ))
      .for("update");

    if (!locked) {
      throw new SafeError("Feedstock not found");
    }

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "feedstock", entityId: feedstockId },
      "delete",
    );

    // Block deletion if used in production runs
    const [usageCount] = await tx
      .select({ count: count() })
      .from(productionRunFeedstocks)
      .where(and(eq(productionRunFeedstocks.feedstockId, feedstockId), eq(productionRunFeedstocks.organizationId, ctx.organizationId)));

    if (Number(usageCount.count) > 0) {
      throw new SafeError(
        "Cannot delete feedstock that is used in production runs. Remove production run associations first."
      );
    }

    if (locked.status === "complete") {
      await lockBinStocks(ctx, tx, [locked.storageLocationId]);
    }

    await deleteTransportLegsForEntity(ctx, tx, "feedstock", feedstockId);
    const result = await tx
      .delete(feedstocks)
      .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));
    if (result.rowCount === 0) {
      throw new SafeError("Feedstock not found");
    }
  });
}

// ============================================
// Utility Operations
// ============================================

export async function isFeedstockCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(feedstocks.organizationId, ctx.organizationId),
    eq(feedstocks.code, code),
  ];
  if (excludeId) {
    conditions.push(sql`${feedstocks.id} != ${excludeId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get feedstock options for dropdowns (e.g., production run feedstock selection)
 */
export async function getFeedstockOptions(
  ctx: OrgContext
): Promise<Array<{ id: string; code: string; massDryKg: number; feedstockTypeName: string | null }>> {
  requireOrgScope(ctx);

  return db
    .select({
      id: feedstocks.id,
      code: feedstocks.code,
      massDryKg: feedstocks.massDryKg,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(feedstocks)
    .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .where(and(isNull(feedstocks.archivedAt), eq(feedstocks.organizationId, ctx.organizationId)))
    .orderBy(desc(feedstocks.createdAt));
}

// ============================================
// Transport leg (auto-derived: supplier → facility)
// ============================================

/**
 * Recompute and persist the feedstock's single transport leg from records we
 * already hold (supplier origin — default location's name/GPS preferred —
 * + facility destination + vehicle + wet cargo mass). Distance resolves in
 * priority order — feedstock-form override → the
 * supplier's DEFAULT location distance → supplier-level distance-to-facility —
 * and the leg inherits the winning level's `distanceSource` (map-integration
 * plan, decision 3). Call after every feedstock create/update.
 */
export async function syncFeedstockTransportLeg(
  ctx: OrgContext,
  feedstockId: string,
  distanceOverride?: {
    distanceKm?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    tripType?: "return" | "one_way" | null;
  },
): Promise<void> {
  requireOrgScope(ctx);

  const [row] = await db
    .select({
      supplierName: suppliers.name,
      supplierGpsLatitude: suppliers.gpsLatitude,
      supplierGpsLongitude: suppliers.gpsLongitude,
      supplierDistanceToFacilityKm: suppliers.distanceToFacilityKm,
      supplierDistanceSource: suppliers.distanceSource,
      locationName: supplierLocations.name,
      locationGpsLatitude: supplierLocations.gpsLatitude,
      locationGpsLongitude: supplierLocations.gpsLongitude,
      locationDistanceFromFacilityKm: supplierLocations.distanceFromFacilityKm,
      locationDistanceSource: supplierLocations.distanceSource,
      facilityName: facilities.name,
      facilityGpsLatitude: facilities.gpsLatitude,
      facilityGpsLongitude: facilities.gpsLongitude,
      vehicleType: vehicles.vehicleType,
      vehicleModelYear: vehicles.modelYear,
      loadMassKg: feedstocks.massWetKg,
    })
    .from(feedstocks)
    .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
    .leftJoin(
      supplierLocations,
      and(
        eq(supplierLocations.supplierId, suppliers.id),
        eq(supplierLocations.isDefault, true),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(facilities, and(eq(feedstocks.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(vehicles, and(eq(feedstocks.vehicleId, vehicles.id), eq(vehicles.organizationId, ctx.organizationId)))
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!row) return;

  // Stored level: the default supplier location wins over the supplier-level
  // default; each carries its own provenance.
  const locationDistance = positiveOrNull(row.locationDistanceFromFacilityKm);
  const storedDistanceKm = locationDistance ?? row.supplierDistanceToFacilityKm;
  const storedDistanceSource =
    locationDistance != null
      ? row.locationDistanceSource
      : row.supplierDistanceSource;

  // Origin identity mirrors the distance priority: the default supplier
  // location is the actual pickup point, so its name/GPS beat the supplier's.
  // GPS falls back as a pair — a lone latitude or longitude is unusable.
  const locationHasGps =
    row.locationGpsLatitude != null && row.locationGpsLongitude != null;

  const derived = deriveTransportLeg({
    origin: {
      name: row.locationName ?? row.supplierName,
      gpsLatitude: locationHasGps ? row.locationGpsLatitude : row.supplierGpsLatitude,
      gpsLongitude: locationHasGps ? row.locationGpsLongitude : row.supplierGpsLongitude,
    },
    destination: {
      name: row.facilityName,
      gpsLatitude: row.facilityGpsLatitude,
      gpsLongitude: row.facilityGpsLongitude,
    },
    vehicle: { vehicleType: row.vehicleType, modelYear: row.vehicleModelYear },
    loadMassKg: row.loadMassKg,
    storedDistanceKm,
    storedDistanceSource,
    distanceKmOverride: distanceOverride?.distanceKm,
    distanceSourceOverride: distanceOverride?.distanceSource,
    tripType: distanceOverride?.tripType,
  });

  await replaceDerivedTransportLeg(ctx, "feedstock", feedstockId, derived);
}

// ============================================
// Helpers
// ============================================

function determineFeedstockStatus(data: {
  feedstockTypeId?: string | null;
  massDryKg?: number | null;
}): "missing_data" | "complete" {
  if (
    data.feedstockTypeId &&
    data.massDryKg !== null &&
    data.massDryKg !== undefined &&
    data.massDryKg > 0
  ) {
    return "complete";
  }
  return "missing_data";
}
