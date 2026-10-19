import { readRecordDependents } from "./record-lock-dependents";
import { assertRecordLockFields } from "@/lib/record-lock-fields";
import { recordLocks } from "@/lib/record-lock";
import { partyArchived } from "@/lib/party-domain-errors";
import { lockSupplierReference } from "./party-reference-guards";
import type { CaptureActivity } from "@/lib/activity-changes";
import type { ActivityEventInput } from "./activity-events";
import { withFeedstockTransportReadiness } from "./feedstock-transport-readiness";
import type { SnapshotStock } from "./stock-effects";
/**
 * Feedstock Data Access Layer
 * Unified CRUD for the combined delivery + bin allocation workflow.
 * Each feedstock record contains both delivery info and bin allocation.
 * Split deliveries (one truck → multiple bins) share a deliveryGroupId.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, SQL } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { countRows, sumNullableNumeric } from "@/db/aggregate";
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
import type {
  FeedstockFilterData,
  FeedstockStatsFilterData,
} from "@/schemas/feedstocks";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope, type Executor } from "./utils";
import {
  deriveMassDryKg,
  exceedsMassWithTolerance,
} from "@/lib/calculations/mass-dry";
import {
  deleteTransportLegsForEntity,
  syncFeedstockTransportLeg,
} from "./transport-legs";
import { resolveDistanceSource, type DistanceSourceValue } from "@/schemas/distance-source";
import { SafeError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { retireDocumentsForEntities } from "./documents";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { assertRowVersion, nextVersion } from "./row-version";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { lockBinStocks } from "./lock-bin-stocks";
import { assertFeedstockBinLanesNotNegative } from "./feedstock-bin-stock-integrity";
import { transportEvidenceDocumentCount } from "./transport-evidence-projections";
import { withAutoCodes } from "./code-generator";

const FEEDSTOCK_INTAKE_BIN_TYPES = ["feedstock_bin"] as const;
/** Entity key on a feedstock's expected-version conflict. */
const FEEDSTOCK_CONFLICT_ENTITY = "feedstock";
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
  referencePath: (index: number) => (string | number)[],
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
  for (const [index, storageLocationId] of storageLocationIds.entries()) {
    const bin = binMap.get(storageLocationId);
    if (!bin) {
      throw new DomainError("not_found", `Storage bin not found: ${storageLocationId}`, {
        issues: [{ path: referencePath(index), code: "not_found", message: "Storage bin was not found." }],
      });
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
  version: number;
  distanceKmOverride: number | null;
  distanceSource: DistanceSourceValue | null;
  distanceNote: string | null;
  id: string;
  code: string;
  facilityId: string;
  status: "missing_data" | "complete";
  // Delivery fields
  deliveryDate: Date;
  supplierId: string;
  vehicleId: string | null;
  deliveryGroupId: string | null;
  overrideJustification: string | null;
  // Material fields
  feedstockTypeId: string;
  massDryKg: number;
  massWetKg: number;
  moistureContentPercent: number;
  storageLocationId: string;
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
  transportEvidenceDocumentCount: number;
  hasUsableTransportLeg?: boolean;
  transportLegDistanceSource?: "map_estimate" | "manual" | "document" | null;
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
  totalDryMassKg: number | null;
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
  feedstockTypeId: string;
  totalWetMassKg: number;
  moisturePercent: number;
  allocations: CreateFeedstockAllocation[];
  overrideJustification?: string | null;
  notes?: string | null;
  distanceNote?: string | null;
  transportDistanceKm?: number | null;
  transportDistanceSource?: DistanceSourceValue | null;
}

export interface UpdateFeedstockInput {
  facilityId?: string;
  deliveryDate?: Date;
  supplierId?: string;
  vehicleId?: string | null;
  feedstockTypeId?: string;
  massWetKg?: number;
  moistureContentPercent?: number;
  storageLocationId?: string;
  overrideJustification?: string | null;
  notes?: string | null;
  distanceNote?: string | null;
  transportDistanceKm?: number | null;
  transportDistanceSource?: DistanceSourceValue | null;
  /** Mandatory version the edit form loaded. */
  expectedVersion: number;
}

export interface CreateFeedstockResult {
  feedstocks: FeedstockWithRelations[];
  warning: string | null;
}

// ============================================
// Select fields
// ============================================

const feedstockSelectFields = {
  distanceKmOverride: feedstocks.distanceKmOverride,
  distanceSource: feedstocks.distanceSource,
  distanceNote: feedstocks.distanceNote,
  version: feedstocks.version,
  id: feedstocks.id,
  code: feedstocks.code,
  facilityId: feedstocks.facilityId,
  status: feedstocks.status,
  deliveryDate: feedstocks.deliveryDate,
  supplierId: feedstocks.supplierId,
  vehicleId: feedstocks.vehicleId,
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
} as const;

/**
 * The joined feedstock projection. `executor` lets a writer run its enrichment
 * read inside the same transaction as the write, so a post-commit read can
 * never report a saved feedstock as missing (issue #769).
 */
function feedstockBaseQuery(ctx: OrgContext, executor: Executor = db) {
  return executor
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

  return { items: await withFeedstockTransportReadiness(ctx, items), total, page, pageSize, totalPages };
}

export async function getFeedstockById(
  ctx: OrgContext,
  feedstockId: string,
  executor: Executor = db
): Promise<FeedstockWithRelations> {
  requireOrgScope(ctx);

  const [item] = await feedstockBaseQuery(ctx, executor).where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!item) {
    throw new DomainError("not_found", "Feedstock not found");
  }

  const [enriched] = await withFeedstockTransportReadiness(ctx, [item], executor);
  return enriched;
}

export async function getFeedstockStats(
  ctx: OrgContext,
  scope?: Partial<FeedstockStatsFilterData>
): Promise<FeedstockStats> {
  requireOrgScope(ctx);

  const { facilityId, feedstockTypeId } = scope ?? {};

  const conditions: SQL[] = [
    eq(feedstocks.organizationId, ctx.organizationId),
    isNull(feedstocks.archivedAt),
  ];
  if (facilityId) conditions.push(eq(feedstocks.facilityId, facilityId));
  // The same predicate the list applies, so the cards never summarise rows the
  // operator cannot see below them.
  if (feedstockTypeId) {
    conditions.push(eq(feedstocks.feedstockTypeId, feedstockTypeId));
  }
  const whereClause = and(...conditions);

  // org-scope-ok: whereClause includes the active organization predicate.
  const [stats] = await db
    .select({
      totalFeedstocks: count(),
      totalDryMassKg: sumNullableNumeric(feedstocks.massDryKg),
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

/** Capture the effective leg distance alongside the row’s override fields. */
export async function readFeedstockTransportSnapshot(ctx: OrgContext, tx: DbTransaction, feedstockId: string) {
  requireOrgScope(ctx);
  const [leg] = await tx.select({
    transportDistanceKm: transportLegs.distanceKm,
    transportDistanceSource: transportLegs.distanceSource,
  }).from(transportLegs).where(and(
    eq(transportLegs.organizationId, ctx.organizationId),
    eq(transportLegs.entityType, "feedstock"),
    eq(transportLegs.entityId, feedstockId),
    eq(transportLegs.isDerived, true),
  ));
  return { transportDistanceKm: leg?.transportDistanceKm ?? null, transportDistanceSource: leg?.transportDistanceSource ?? null };
}

/**
 * Record a feedstock delivery and its bin allocations inside a caller-owned
 * transaction owned by the operation runner. Every
 * read and write goes through `tx`: at pool size 1 a read through the global
 * `db` would wait on this transaction's own connection.
 */
export async function createFeedstockInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  data: CreateFeedstockInput,
  snapshotStock?: SnapshotStock,
  capture?: CaptureActivity,
): Promise<CreateFeedstockResult> {
  requireOrgScope(ctx);
  await withFeedstockErrors(() => assertSameOrg(ctx, feedstockTypes, data.feedstockTypeId, tx), "not_found", ["feedstockTypeId"]);
  if (data.vehicleId) await withFeedstockErrors(() => assertSameOrg(ctx, vehicles, data.vehicleId!, tx), "not_found", ["vehicleId"]);
  for (const [index, allocation] of data.allocations.entries()) {
    await withFeedstockErrors(
      () => assertSameOrg(ctx, storageLocations, allocation.storageLocationId, tx),
      "not_found", ["allocations", index, "storageLocationId"],
    );
  }

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
  const [feedstockType] = await tx
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

  if (!feedstockType) {
    throw new DomainError("not_found", "Feedstock type not found", {
      issues: [{ path: ["feedstockTypeId"], code: "not_found", message: "Feedstock type was not found." }],
    });
  }

  const binIds = data.allocations.map((a) => a.storageLocationId);
  await withFeedstockErrors(() => lockActiveFacilityReference(ctx, tx, data.facilityId), "not_found", ["facilityId"]);
  await lockSupplierReference(ctx, tx, data.supplierId);
  await lockBinStocks(ctx, tx, binIds);
  await validateFeedstockStorageLocations(
    ctx,
    tx,
    binIds,
    data.facilityId,
    data.feedstockTypeId,
    (index) => ["allocations", index, "storageLocationId"],
  );

  await snapshotStock?.(tx, binIds);

  const items = await withAutoCodes(
    ctx,
    tx,
    "FS",
    feedstocks,
    feedstocks.code,
    data.allocations.length,
    async (codes, savepoint) => {
      const results: string[] = [];

      for (let i = 0; i < data.allocations.length; i++) {
        const allocation = data.allocations[i];
        const allocatedDryMassKg = deriveMassDryKg(allocation.allocatedWetMassKg, data.moisturePercent);

        const status = determineFeedstockStatus({
          feedstockTypeId: data.feedstockTypeId,
          massDryKg: allocatedDryMassKg,
          massWetKg: allocation.allocatedWetMassKg,
        });

        const [feedstock] = await savepoint
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
            deliveryGroupId,
            ...feedstockDistanceColumns(data),
            overrideJustification: data.overrideJustification || null,
            // Material fields
            feedstockTypeId: data.feedstockTypeId,
            massDryKg: allocatedDryMassKg,
            massWetKg: allocation.allocatedWetMassKg,
            moistureContentPercent: data.moisturePercent,
            storageLocationId: allocation.storageLocationId,
            notes: data.notes || null,
          })
          .returning();

        results.push(feedstock.id);

        await syncFeedstockTransportLeg(ctx, savepoint, feedstock.id);
        if (capture) capture(feedstock.id, null, { ...feedstock, ...await readFeedstockTransportSnapshot(ctx, savepoint, feedstock.id) });

        // Lock feedstock type on bin (first-use lock)
        await savepoint
          .update(storageLocations)
          .set({ version: nextVersion(storageLocations.version), feedstockTypeId: data.feedstockTypeId })
          .where(
            and(
              eq(storageLocations.id, allocation.storageLocationId),
              eq(storageLocations.organizationId, ctx.organizationId),
              sql`${storageLocations.feedstockTypeId} is null`
            )
          );
      }

      // Read the created records back inside the transaction. A read after the
      // commit can fail on its own, and an empty result then looks identical to
      // "nothing was created" (issue #769).
      return feedstockBaseQuery(ctx, savepoint)
        .where(and(inArray(feedstocks.id, results), eq(feedstocks.organizationId, ctx.organizationId)));
    },
  );

  // Generate warning if allocated wet mass > total delivery wet mass
  let warning: string | null = null;
  if (allocationsExceedDelivery) {
    warning = `Allocated wet mass (${allocatedTotalWetKg.toFixed(1)} kg) exceeds total delivery wet mass (${data.totalWetMassKg.toFixed(1)} kg).`;
  }

  return { feedstocks: items, warning };
}

/** The sole input-to-column mapping for persisted feedstock distance overrides. */
function feedstockDistanceColumns(
  input: Pick<UpdateFeedstockInput, "transportDistanceKm" | "transportDistanceSource" | "distanceNote">,
  previous?: Pick<FeedstockWithRelations, "distanceKmOverride" | "distanceSource">,
  routeAnchorChanged = false,
) {
  if (previous && input.transportDistanceKm === undefined && input.transportDistanceSource != null
    && (previous.distanceKmOverride == null || routeAnchorChanged)) {
    throw new DomainError("validation_failed", "The feedstock distance source was not changed. Set transportDistanceKm to change its source.");
  }
  // The v1 input contract accepts zero; it means derived, never a stored override.
  const distanceKmOverride = input.transportDistanceKm !== undefined
    ? input.transportDistanceKm === 0 ? null : input.transportDistanceKm
    : routeAnchorChanged ? null : previous?.distanceKmOverride ?? null;
  const source = input.transportDistanceKm === undefined && input.transportDistanceSource === undefined && !routeAnchorChanged
    ? previous?.distanceSource
    : input.transportDistanceSource;
  return {
    distanceKmOverride,
    distanceSource: resolveDistanceSource(distanceKmOverride, source),
    distanceNote: distanceKmOverride === null || input.distanceNote === "" ? null : input.distanceNote,
  };
}

// ============================================
// Update Operations
// ============================================

export async function updateFeedstockInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockId: string,
  data: UpdateFeedstockInput,
  snapshotStock?: SnapshotStock,
  capture?: CaptureActivity,
): Promise<FeedstockWithRelations> {
  requireOrgScope(ctx);
  const {
    transportDistanceKm,
    transportDistanceSource,
    expectedVersion,
    distanceNote,
    ...feedstockData
  } = data;
  if (feedstockData.vehicleId) await withFeedstockErrors(() => assertSameOrg(ctx, vehicles, feedstockData.vehicleId!, tx), "not_found", ["vehicleId"]);
  if (feedstockData.feedstockTypeId) await withFeedstockErrors(() => assertSameOrg(ctx, feedstockTypes, feedstockData.feedstockTypeId!, tx), "not_found", ["feedstockTypeId"]);
  if (feedstockData.storageLocationId) await withFeedstockErrors(() => assertSameOrg(ctx, storageLocations, feedstockData.storageLocationId!, tx), "not_found", ["storageLocationId"]);

  if (feedstockData.facilityId !== undefined) {
    await withFeedstockErrors(() => lockActiveFacilityReference(ctx, tx, feedstockData.facilityId!), "not_found", ["facilityId"]);
  }
  const supplier = feedstockData.supplierId !== undefined
    ? await lockSupplierReference(ctx, tx, feedstockData.supplierId, { allowArchived: true })
    : undefined;

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
    throw new DomainError("not_found", "Feedstock not found");
  }
  assertRowVersion({
    entity: FEEDSTOCK_CONFLICT_ENTITY,
    id: feedstockId,
    expectedVersion,
    actualVersion: locked.version,
  });
  if (feedstockData.supplierId !== undefined && feedstockData.supplierId !== locked.supplierId && supplier?.archivedAt) {
    throw partyArchived("supplier", supplier.code);
  }
  const transportBefore = capture ? await readFeedstockTransportSnapshot(ctx, tx, feedstockId) : undefined;

  await withFeedstockErrors(() => assertCanMutateCertifiedLineage(
    ctx,
    tx,
    { entityType: "feedstock", entityId: feedstockId },
    "update",
  ), "certification_locked");

  assertRecordLockFields(recordLocks.feedstock({ removals: [], dependents: await readRecordDependents(ctx, tx, { entityType: "feedstock", entityId: feedstockId }) }), locked, feedstockData);
  // Derive before anything reads the new masses: the status, the stock-lane
  // check, and the write below must all see the same dry figure.
  const derivedMassDryKg = resolveFeedstockDryMass(locked, feedstockData);
  const effectiveChanges = { ...feedstockData, massDryKg: derivedMassDryKg };

  const status = determineFeedstockStatus({ ...locked, ...effectiveChanges });
  const routeAnchorChanged =
    (feedstockData.supplierId !== undefined &&
      feedstockData.supplierId !== locked.supplierId) ||
    (feedstockData.facilityId !== undefined &&
      feedstockData.facilityId !== locked.facilityId);
  const distanceColumns = feedstockDistanceColumns({ transportDistanceKm, transportDistanceSource, distanceNote }, locked, routeAnchorChanged);
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
    (effectiveChanges.massDryKg !== undefined &&
      effectiveChanges.massDryKg !== locked.massDryKg) ||
    (feedstockData.massWetKg !== undefined &&
      feedstockData.massWetKg !== locked.massWetKg) ||
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
      () => ["storageLocationId"],
    );
  }

  await snapshotStock?.(tx, stockDerivationChanged || storageReferenceNeedsValidation ? [locked.storageLocationId, effectiveStorageLocationId] : []);

  const [saved] = await tx
    .update(feedstocks)
    .set({
      ...effectiveChanges,
      ...distanceColumns,
      status,
      version: nextVersion(feedstocks.version),
      updatedAt: new Date(),
    })
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId))).returning();

  // Re-derive the affected lanes now that the new row is visible, while the
  // bin locks above are still held. Validating the bin reference only proves
  // the bin is usable, never that the edited mass still covers withdrawals.
  if (stockDerivationChanged) {
    await assertFeedstockBinLanesNotNegative(
      ctx,
      tx,
      [locked.storageLocationId, effectiveStorageLocationId],
      "save",
    );
  }

  await syncFeedstockTransportLeg(ctx, tx, feedstockId, {
    refreshFromLocation: (transportDistanceKm !== undefined && locked.distanceKmOverride != null && distanceColumns.distanceKmOverride === null) || routeAnchorChanged,
  });
  if (capture) capture(feedstockId, { ...locked, ...transportBefore }, { ...saved, ...await readFeedstockTransportSnapshot(ctx, tx, feedstockId) });

  // Read the updated record back inside the transaction, so a failed read
  // rolls the update back instead of reporting a saved feedstock as
  // "Feedstock not found" (issue #769).
  return getFeedstockById(ctx, feedstockId, tx);
}

// ============================================
// Delete Operations
// ============================================

export async function deleteFeedstockInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockId: string,
  expectedVersion: number,
  source: ActivityEventInput["source"],
  snapshotStock?: SnapshotStock,
): Promise<{ facilityId: string }> {
  requireOrgScope(ctx);

  const [locked] = await tx
    .select({
      id: feedstocks.id,
      facilityId: feedstocks.facilityId,
      version: feedstocks.version,
      status: feedstocks.status,
      storageLocationId: feedstocks.storageLocationId,
    })
    .from(feedstocks)
    .where(and(
      eq(feedstocks.id, feedstockId),
      eq(feedstocks.organizationId, ctx.organizationId),
      isNull(feedstocks.archivedAt),
    ))
    .for("update");

  if (!locked) {
    throw new DomainError("not_found", "Feedstock not found");
  }

  assertRowVersion({
    entity: FEEDSTOCK_CONFLICT_ENTITY,
    id: feedstockId,
    expectedVersion,
    actualVersion: locked.version,
  });

  await withFeedstockErrors(() => assertCanMutateCertifiedLineage(
    ctx,
    tx,
    { entityType: "feedstock", entityId: feedstockId },
    "delete",
  ), "certification_locked");

  // Block deletion if used in production runs
  const [usageCount] = await tx
    .select({ count: count() })
    .from(productionRunFeedstocks)
    .where(and(eq(productionRunFeedstocks.feedstockId, feedstockId), eq(productionRunFeedstocks.organizationId, ctx.organizationId)));

  if (Number(usageCount.count) > 0) {
    throw new DomainError("certification_locked",
      "Cannot delete feedstock that is used in production runs. Remove production run associations first."
    );
  }

  if (locked.status === "complete") {
    await lockBinStocks(ctx, tx, [locked.storageLocationId]);
  }

  await snapshotStock?.(tx, locked.status === "complete" ? [locked.storageLocationId] : []);

  const transportLegDocuments = await deleteTransportLegsForEntity(
    ctx,
    tx,
    "feedstock",
    feedstockId,
    source,
  );
  const result = await tx
    .delete(feedstocks)
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));
  if (result.rowCount === 0) {
    throw new DomainError("not_found", "Feedstock not found");
  }
  // Removing a complete intake shrinks the lane the same way an edit does.
  if (locked.status === "complete") {
    await assertFeedstockBinLanesNotNegative(
      ctx,
      tx,
      [locked.storageLocationId],
      "delete",
    );
  }
  await retireDocumentsForEntities(ctx, tx, [
    { entityType: "feedstock", entityId: feedstockId },
    ...transportLegDocuments,
  ], source);
  return { facilityId: locked.facilityId };
}

// ============================================
// Utility Operations
// ============================================

// ============================================
// Helpers
// ============================================

/** Derive dry mass from the locked row and the supplied wet mass or moisture. */
function resolveFeedstockDryMass(
  stored: { massWetKg: number; moistureContentPercent: number },
  patch: { massWetKg?: number; moistureContentPercent?: number },
): number {
  return deriveMassDryKg(
    patch.massWetKg ?? stored.massWetKg,
    patch.moistureContentPercent ?? stored.moistureContentPercent,
  );
}

function determineFeedstockStatus(data: {
  feedstockTypeId?: string | null;
  massDryKg?: number | null;
  massWetKg?: number;
}): "missing_data" | "complete" {
  if (
    data.feedstockTypeId &&
    data.massDryKg !== null &&
    data.massDryKg !== undefined &&
    data.massDryKg > 0 &&
    data.massWetKg !== null &&
    data.massWetKg !== undefined &&
    data.massWetKg > 0
  ) {
    return "complete";
  }
  return "missing_data";
}
