/**
 * Feedstock Data Access Layer
 * Unified CRUD for the combined delivery + bin allocation workflow.
 * Each feedstock record contains both delivery info and bin allocation.
 * Split deliveries (one truck → multiple bins) share a deliveryGroupId.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, SQL } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { countRows, sumNumeric } from "@/db/aggregate";
import {
  feedstocks,
  feedstockTypes,
  facilities,
  storageLocations,
  suppliers,
  vehicles,
  productionRunFeedstocks,
  transportLegs,
} from "@/db/schema";
import type { FeedstockFilterData } from "@/schemas/feedstocks";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import {
  deriveMassDryKg,
  exceedsMassWithTolerance,
} from "@/lib/calculations/mass-dry";
import {
  deleteTransportLegsForEntity,
  syncFeedstockTransportLeg,
  type FeedstockTransportOverride,
} from "./transport-legs";
import { SafeError } from "@/lib/errors";
import { retireDocumentsForEntities } from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { lockBinStocks } from "./lock-bin-stocks";
import { transportEvidenceDocumentCount } from "./transport-evidence-projections";

const FEEDSTOCK_INTAKE_BIN_TYPES = ["feedstock_bin"] as const;
const ALLOCATION_OVERAGE_JUSTIFICATION_MESSAGE =
  "Enter a justification when allocated wet mass exceeds the declared delivery mass";

function isFeedstockIntakeBinType(type: string): boolean {
  return FEEDSTOCK_INTAKE_BIN_TYPES.some((binType) => binType === type);
}

async function validateFeedstockStorageLocations(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationIds: readonly string[],
  facilityId: string,
  feedstockTypeId: string,
): Promise<void> {
  if (storageLocationIds.length === 0) return;

  const bins = await tx
    .select({
      id: storageLocations.id,
      type: storageLocations.type,
      feedstockTypeId: storageLocations.feedstockTypeId,
      facilityId: storageLocations.facilityId,
    })
    .from(storageLocations)
    .where(
      and(
        inArray(storageLocations.id, storageLocationIds),
        eq(storageLocations.organizationId, ctx.organizationId),
        isNull(storageLocations.archivedAt),
      ),
    );

  const binMap = new Map(bins.map((bin) => [bin.id, bin]));
  for (const storageLocationId of storageLocationIds) {
    const bin = binMap.get(storageLocationId);
    if (!bin) {
      throw new SafeError(`Storage bin not found: ${storageLocationId}`);
    }
    if (bin.facilityId !== facilityId) {
      throw new SafeError(
        `Storage bin ${bin.id} does not belong to the selected facility`,
      );
    }
    if (!isFeedstockIntakeBinType(bin.type)) {
      throw new SafeError(
        `Feedstock materials must be allocated to a feedstock bin, not a ${bin.type.replace("_", " ")}.`,
      );
    }
    if (bin.feedstockTypeId && bin.feedstockTypeId !== feedstockTypeId) {
      throw new SafeError(
        "Storage bin already holds a different feedstock type. Each bin can only hold one type.",
      );
    }
  }
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
  transportDistanceKm: number | null;
  transportDistanceSource: "map_estimate" | "manual" | "document" | null;
  transportTripType: "return" | "one_way" | null;
  transportEvidenceDocumentCount: number;
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
  transportDistanceKm?: number | null;
  transportDistanceSource?: FeedstockTransportOverride["distanceSource"];
  transportTripType?: FeedstockTransportOverride["tripType"];
}

export interface UpdateFeedstockInput {
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
  transportDistanceKm?: number | null;
  transportDistanceSource?: FeedstockTransportOverride["distanceSource"];
  transportTripType?: FeedstockTransportOverride["tripType"];
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
  transportDistanceKm: transportLegs.distanceKm,
  transportDistanceSource: transportLegs.distanceSource,
  transportTripType: transportLegs.tripType,
} as const;

function feedstockBaseQuery(ctx: OrgContext) {
  return db
    .select({
      ...feedstockSelectFields,
      transportEvidenceDocumentCount: transportEvidenceDocumentCount(
        ctx.organizationId,
        "feedstock",
        "feedstockId",
      ),
    })
    .from(feedstocks)
    .leftJoin(facilities, and(eq(feedstocks.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
    .leftJoin(vehicles, and(eq(feedstocks.vehicleId, vehicles.id), eq(vehicles.organizationId, ctx.organizationId)))
    .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(feedstocks.storageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)))
    .leftJoin(
      transportLegs,
      and(
        eq(transportLegs.entityType, "feedstock"),
        eq(transportLegs.entityId, feedstocks.id),
        eq(transportLegs.isDerived, true),
        eq(transportLegs.organizationId, ctx.organizationId),
      ),
    );
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
  const allocationsExceedDelivery = exceedsMassWithTolerance(
    allocatedTotalWetKg,
    data.totalWetMassKg,
  );
  if (allocationsExceedDelivery && !data.overrideJustification?.trim()) {
    throw new SafeError(ALLOCATION_OVERAGE_JUSTIFICATION_MESSAGE);
  }
  const deliveryGroupId = data.allocations.length > 1 ? crypto.randomUUID() : null;

  // Confirm the feedstock type exists before locking compatible bins to it.
  const [feedstockType] = await db
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

  if (!feedstockType) {
    throw new SafeError("Feedstock type not found");
  }

  const binIds = data.allocations.map((a) => a.storageLocationId);
  const codes = await codesFn(data.allocations.length);

  const createdFeedstocks = await db.transaction(async (tx) => {
    await lockActiveFacilityReference(ctx, tx, data.facilityId);
    await lockBinStocks(ctx, tx, binIds);
    await validateFeedstockStorageLocations(
      ctx,
      tx,
      binIds,
      data.facilityId,
      data.feedstockTypeId,
    );
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

      await syncFeedstockTransportLeg(ctx, tx, feedstock.id, {
        distanceKm: data.transportDistanceKm,
        distanceSource: data.transportDistanceSource,
        tripType: data.transportTripType,
      });

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
  if (allocationsExceedDelivery) {
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
  data: UpdateFeedstockInput,
): Promise<FeedstockWithRelations> {
  requireOrgScope(ctx);
  const {
    transportDistanceKm,
    transportDistanceSource,
    transportTripType,
    ...feedstockData
  } = data;
  if (feedstockData.supplierId) await assertSameOrg(ctx, suppliers, feedstockData.supplierId);
  if (feedstockData.vehicleId) await assertSameOrg(ctx, vehicles, feedstockData.vehicleId);
  if (feedstockData.feedstockTypeId) await assertSameOrg(ctx, feedstockTypes, feedstockData.feedstockTypeId);
  if (feedstockData.storageLocationId) await assertSameOrg(ctx, storageLocations, feedstockData.storageLocationId);

  const [existing] = await db
    .select()
    .from(feedstocks)
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Feedstock not found");
  }

  await db.transaction(async (tx) => {
    if (feedstockData.facilityId !== undefined) {
      await lockActiveFacilityReference(ctx, tx, feedstockData.facilityId);
    }

    const [locked] = await tx
      .select()
      .from(feedstocks)
      .where(and(
        eq(feedstocks.id, feedstockId),
        eq(feedstocks.organizationId, ctx.organizationId),
        isNull(feedstocks.archivedAt),
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

    const status = determineFeedstockStatus({ ...locked, ...feedstockData });
    const routeAnchorChanged =
      (feedstockData.supplierId !== undefined &&
        feedstockData.supplierId !== locked.supplierId) ||
      (feedstockData.facilityId !== undefined &&
        feedstockData.facilityId !== locked.facilityId);
    const explicitDistanceSupplied = transportDistanceKm !== undefined;
    const explicitDistanceSourceSupplied =
      transportDistanceSource !== undefined;
    const effectiveStorageLocationId =
      feedstockData.storageLocationId !== undefined
        ? feedstockData.storageLocationId
        : locked.storageLocationId;
    const effectiveFeedstockTypeId =
      feedstockData.feedstockTypeId ?? locked.feedstockTypeId;
    const effectiveFacilityId =
      feedstockData.facilityId ?? locked.facilityId;
    const storageReferenceNeedsValidation =
      feedstockData.storageLocationId !== undefined ||
      feedstockData.feedstockTypeId !== undefined ||
      feedstockData.facilityId !== undefined;
    const stockDerivationChanged =
      status !== locked.status ||
      (feedstockData.massDryKg !== undefined && feedstockData.massDryKg !== locked.massDryKg) ||
      (feedstockData.storageLocationId !== undefined &&
        feedstockData.storageLocationId !== locked.storageLocationId);

    if (stockDerivationChanged || storageReferenceNeedsValidation) {
      await lockBinStocks(ctx, tx, [
        locked.storageLocationId,
        effectiveStorageLocationId,
      ]);
    }
    if (storageReferenceNeedsValidation && effectiveStorageLocationId) {
      await validateFeedstockStorageLocations(
        ctx,
        tx,
        [effectiveStorageLocationId],
        effectiveFacilityId,
        effectiveFeedstockTypeId,
      );
    }

    await tx
      .update(feedstocks)
      .set({
        ...feedstockData,
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

    await syncFeedstockTransportLeg(ctx, tx, feedstockId, {
      distanceKm: transportDistanceKm,
      distanceSource: transportDistanceSource,
      tripType: transportTripType,
      resetDistanceToRoute:
        routeAnchorChanged &&
        !explicitDistanceSupplied &&
        !explicitDistanceSourceSupplied,
    });
  });
  await processPendingStorageObjectDeletions(ctx);

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

    const transportLegDocuments = await deleteTransportLegsForEntity(
      ctx,
      tx,
      "feedstock",
      feedstockId,
    );
    const result = await tx
      .delete(feedstocks)
      .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));
    if (result.rowCount === 0) {
      throw new SafeError("Feedstock not found");
    }
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "feedstock", entityId: feedstockId },
      ...transportLegDocuments,
    ]);
  });
  await processPendingStorageObjectDeletions(ctx);
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
