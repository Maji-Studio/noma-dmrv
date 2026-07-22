/**
 * Facilities Data Access Layer
 * CRUD operations for facilities with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, SQL, count, countDistinct } from "drizzle-orm";
import { db } from "@/db";
import { numericAggregate, sumNumeric } from "@/db/aggregate";
import type { OrgContext } from "@/lib/auth/server";
import {
  facilities,
  reactors,
  storageLocations,
  feedstockDeliveries,
  feedstocks,
  productionRuns,
  productionRunFeedstocks,
  biocharProducts,
  formulations,
  orders,
  deliveries,
  applications,
  creditBatches,
  samples,
  stockpileEvents,
  powerProcurementEvidence,
  type Facility,
} from "@/db/schema";
import { hasBlockingFacilitySubmission } from "./certification";
import type { FacilityFilterData } from "@/schemas/facilities";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";

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

import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";

// ============================================
// Read Operations
// ============================================

/**
 * Get all facilities with pagination and filtering
 * Supports search, country filter, sorting, and pagination
 */
export async function getFacilities(
  ctx: OrgContext,
  filters?: Partial<FacilityFilterData>
): Promise<PaginatedFacilities> {
  requireOrgScope(ctx);

  const {
    search,
    country,
    archived = false,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions — active facilities by default, archived-only view on demand
  const conditions: SQL[] = [
    eq(facilities.organizationId, ctx.organizationId),
    archived ? isNotNull(facilities.archivedAt) : isNull(facilities.archivedAt),
  ];

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
  // org-scope-ok: whereClause includes the active organization predicate.
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
      organizationId: facilities.organizationId,
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
      durabilityOption: facilities.durabilityOption,
      archivedAt: facilities.archivedAt,
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
          .where(and(inArray(reactors.facilityId, facilityIds), eq(reactors.organizationId, ctx.organizationId)))
          .orderBy(asc(reactors.facilityId), asc(reactors.code)),
        db
          .select({
            facilityId: storageLocations.facilityId,
            type: storageLocations.type,
            count: count(),
          })
          .from(storageLocations)
          .where(and(inArray(storageLocations.facilityId, facilityIds), eq(storageLocations.organizationId, ctx.organizationId)))
          .groupBy(storageLocations.facilityId, storageLocations.type),
        db
          .select({
            facilityId: feedstocks.facilityId,
            totalDryKg: sumNumeric(feedstocks.massDryKg),
          })
          .from(feedstocks)
          .where(and(inArray(feedstocks.facilityId, facilityIds), eq(feedstocks.organizationId, ctx.organizationId)))
          .groupBy(feedstocks.facilityId),
        db
          .select({
            facilityId: productionRuns.facilityId,
            totalConsumedKg: sumNumeric(productionRunFeedstocks.massUsedKg),
          })
          .from(productionRuns)
          .leftJoin(
            productionRunFeedstocks,
            and(eq(productionRunFeedstocks.productionRunId, productionRuns.id), eq(productionRunFeedstocks.organizationId, ctx.organizationId))
          )
          .where(and(
            inArray(productionRuns.facilityId, facilityIds),
            eq(productionRuns.organizationId, ctx.organizationId),
            ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
          ))
          .groupBy(productionRuns.facilityId),
        db
          .select({
            facilityId: productionRuns.facilityId,
            totalProducedKg: sumNumeric(productionRuns.biocharOutputKg),
          })
          .from(productionRuns)
          .where(and(
            inArray(productionRuns.facilityId, facilityIds),
            eq(productionRuns.organizationId, ctx.organizationId),
            ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
          ))
          .groupBy(productionRuns.facilityId),
        db
          .select({
            facilityId: biocharProducts.facilityId,
            totalAllocatedKg: numericAggregate(sql<number>`
              COALESCE(
                SUM(
                  COALESCE(${biocharProducts.massKg}, 0) * COALESCE(${biocharProducts.biocharRatio}, ${formulations.biocharRatio}, 1)
                ),
                0
              )
            `),
          })
          .from(biocharProducts)
          .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
          .where(and(inArray(biocharProducts.facilityId, facilityIds), eq(biocharProducts.organizationId, ctx.organizationId)))
          .groupBy(biocharProducts.facilityId),
        db
          .select({
            facilityId: biocharProducts.facilityId,
            totalProductKg: sumNumeric(biocharProducts.massKg),
          })
          .from(biocharProducts)
          .where(and(inArray(biocharProducts.facilityId, facilityIds), eq(biocharProducts.organizationId, ctx.organizationId)))
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
    feedstockInventoryRows.map((row) => [row.facilityId, row.totalDryKg])
  );
  const feedstockConsumptionMap = new Map(
    feedstockConsumptionRows.map((row) => [row.facilityId, row.totalConsumedKg])
  );
  const biocharOutputMap = new Map(
    biocharOutputRows.map((row) => [row.facilityId, row.totalProducedKg])
  );
  const biocharAllocationMap = new Map(
    biocharAllocationRows.map((row) => [row.facilityId, row.totalAllocatedKg])
  );
  const productInventoryMap = new Map(
    productInventoryRows.map((row) => [row.facilityId, row.totalProductKg])
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
  ctx: OrgContext,
  facilityId: string
): Promise<Facility> {
  requireOrgScope(ctx);

  const [facility] = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

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
  ctx: OrgContext,
  facilityId: string
): Promise<FacilityDetail> {
  requireOrgScope(ctx);

  // Get facility
  const [facility] = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

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
    .where(and(eq(reactors.facilityId, facilityId), eq(reactors.organizationId, ctx.organizationId)))
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
    .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
  facilityId: string
): Promise<
  Array<{
    id: string;
    code: string;
    identifier: string;
    reactorType: string;
    nominalThroughputTph: number | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
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
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      reactorType: reactors.reactorType,
      nominalThroughputTph: reactors.nominalThroughputTph,
      createdAt: reactors.createdAt,
      updatedAt: reactors.updatedAt,
    })
    .from(reactors)
    .where(and(eq(reactors.facilityId, facilityId), eq(reactors.organizationId, ctx.organizationId)))
    .orderBy(asc(reactors.code));
}

/**
 * Get storage locations associated with a facility
 */
export async function getFacilityStorageLocations(
  ctx: OrgContext,
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
    .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.organizationId, ctx.organizationId)))
    .orderBy(asc(storageLocations.code));
}

export { createFacility, updateFacility } from "./facility-mutations";

// ============================================
// Archive Operations (soft delete, reversible)
// ============================================

export interface FacilityArchiveImpact {
  reactorCount: number;
  storageLocationCount: number;
  feedstockDeliveryCount: number;
  feedstockCount: number;
  productionRunCount: number;
  biocharProductCount: number;
  orderCount: number;
  deliveryCount: number;
  applicationCount: number;
  creditBatchCount: number;
  sampleCount: number;
  stockpileEventCount: number;
  powerProcurementEvidenceCount: number;
  /**
   * True when the facility has removals/GHG statements submitted to the
   * certifier registry. Archiving stays allowed (the registry keeps its own
   * records) — the UI surfaces a warning instead of blocking.
   */
  hasRegistrySubmissions: boolean;
}

/**
 * Preview what archiving a facility would affect.
 * Drives the confirm dialog (child counts + registry-submission warning).
 */
export async function getFacilityArchiveImpact(
  ctx: OrgContext,
  facilityId: string
): Promise<FacilityArchiveImpact> {
  requireOrgScope(ctx);

  const [existing] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Facility not found");
  }

  const [
    [reactorCount],
    [storageCount],
    [feedstockDeliveryCount],
    [feedstockCount],
    [runCount],
    [productCount],
    [orderCount],
    [deliveryCount],
    [applicationCount],
    [batchCount],
    [sampleCount],
    [stockpileEventCount],
    [powerEvidenceCount],
    hasRegistrySubmissions,
  ] = await Promise.all([
    db.select({ count: count() }).from(reactors).where(and(eq(reactors.facilityId, facilityId), eq(reactors.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(storageLocations).where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(feedstockDeliveries).where(and(eq(feedstockDeliveries.facilityId, facilityId), eq(feedstockDeliveries.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(feedstocks).where(and(eq(feedstocks.facilityId, facilityId), eq(feedstocks.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(productionRuns).where(and(eq(productionRuns.facilityId, facilityId), eq(productionRuns.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(biocharProducts).where(and(eq(biocharProducts.facilityId, facilityId), eq(biocharProducts.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(orders).where(and(eq(orders.facilityId, facilityId), eq(orders.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(deliveries).where(and(eq(deliveries.facilityId, facilityId), eq(deliveries.organizationId, ctx.organizationId))),
    db
      .select({ count: count() })
      .from(applications)
      .innerJoin(
        deliveries,
        and(
          eq(applications.deliveryId, deliveries.id),
          eq(deliveries.organizationId, ctx.organizationId),
        ),
      )
      .where(
        and(
          eq(applications.organizationId, ctx.organizationId),
          eq(deliveries.facilityId, facilityId),
        ),
      ),
    db.select({ count: count() }).from(creditBatches).where(and(eq(creditBatches.facilityId, facilityId), eq(creditBatches.organizationId, ctx.organizationId))),
    // Mirror the getSamples read model: a sample's effective facility comes from
    // EITHER its production-run or its credit-batch parent (schema still allows
    // run-linked, batchless provenance). An inner join through creditBatchId
    // alone dropped those rows, undercounting the archive impact. Left-join both
    // parents and count distinct samples where either facility matches.
    db
      .select({ count: countDistinct(samples.id) })
      .from(samples)
      .leftJoin(
        productionRuns,
        and(
          eq(samples.productionRunId, productionRuns.id),
          eq(productionRuns.organizationId, ctx.organizationId),
        ),
      )
      .leftJoin(
        creditBatches,
        and(
          eq(samples.creditBatchId, creditBatches.id),
          eq(creditBatches.organizationId, ctx.organizationId),
        ),
      )
      .where(
        and(
          eq(samples.organizationId, ctx.organizationId),
          or(
            eq(productionRuns.facilityId, facilityId),
            eq(creditBatches.facilityId, facilityId),
          ),
        ),
      ),
    db.select({ count: count() }).from(stockpileEvents).where(and(eq(stockpileEvents.facilityId, facilityId), eq(stockpileEvents.organizationId, ctx.organizationId))),
    db.select({ count: count() }).from(powerProcurementEvidence).where(and(eq(powerProcurementEvidence.facilityId, facilityId), eq(powerProcurementEvidence.organizationId, ctx.organizationId))),
    hasBlockingFacilitySubmission(ctx, db, facilityId, "isometric"),
  ]);

  return {
    reactorCount: Number(reactorCount.count),
    storageLocationCount: Number(storageCount.count),
    feedstockDeliveryCount: Number(feedstockDeliveryCount.count),
    feedstockCount: Number(feedstockCount.count),
    productionRunCount: Number(runCount.count),
    biocharProductCount: Number(productCount.count),
    orderCount: Number(orderCount.count),
    deliveryCount: Number(deliveryCount.count),
    applicationCount: Number(applicationCount.count),
    creditBatchCount: Number(batchCount.count),
    sampleCount: Number(sampleCount.count),
    stockpileEventCount: Number(stockpileEventCount.count),
    powerProcurementEvidenceCount: Number(powerEvidenceCount.count),
    hasRegistrySubmissions,
  };
}

/**
 * Archive a facility (soft delete, reversible via restoreFacility).
 * Cascades the same archived_at stamp to every facility-scoped child table in
 * one transaction; grandchildren (samples, readings, applications, …) and
 * certifier registry mirrors are hidden transitively through their parent.
 */
export async function archiveFacility(
  ctx: OrgContext,
  facilityId: string
): Promise<Facility> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: facilities.id, archivedAt: facilities.archivedAt })
      .from(facilities)
      .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

    if (!existing) {
      throw new SafeError("Facility not found");
    }
    if (existing.archivedAt) {
      throw new SafeError("Facility is already archived");
    }

    const archivedAt = new Date();

    const [archived] = await tx
      .update(facilities)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
      .returning();

    // Cascade: only rows not already archived get this stamp, so a future
    // per-entity archive cannot be clobbered (restore clears indiscriminately
    // today because facility cascade is the only writer of archived_at).
    await tx.update(reactors).set({ archivedAt }).where(and(eq(reactors.facilityId, facilityId), eq(reactors.organizationId, ctx.organizationId), isNull(reactors.archivedAt)));
    await tx.update(storageLocations).set({ archivedAt }).where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.organizationId, ctx.organizationId), isNull(storageLocations.archivedAt)));
    await tx.update(feedstockDeliveries).set({ archivedAt }).where(and(eq(feedstockDeliveries.facilityId, facilityId), eq(feedstockDeliveries.organizationId, ctx.organizationId), isNull(feedstockDeliveries.archivedAt)));
    await tx.update(feedstocks).set({ archivedAt }).where(and(eq(feedstocks.facilityId, facilityId), eq(feedstocks.organizationId, ctx.organizationId), isNull(feedstocks.archivedAt)));
    await tx.update(productionRuns).set({ archivedAt }).where(and(eq(productionRuns.facilityId, facilityId), eq(productionRuns.organizationId, ctx.organizationId), isNull(productionRuns.archivedAt)));
    await tx.update(biocharProducts).set({ archivedAt }).where(and(eq(biocharProducts.facilityId, facilityId), eq(biocharProducts.organizationId, ctx.organizationId), isNull(biocharProducts.archivedAt)));
    await tx.update(orders).set({ archivedAt }).where(and(eq(orders.facilityId, facilityId), eq(orders.organizationId, ctx.organizationId), isNull(orders.archivedAt)));
    await tx.update(deliveries).set({ archivedAt }).where(and(eq(deliveries.facilityId, facilityId), eq(deliveries.organizationId, ctx.organizationId), isNull(deliveries.archivedAt)));
    await tx.update(creditBatches).set({ archivedAt }).where(and(eq(creditBatches.facilityId, facilityId), eq(creditBatches.organizationId, ctx.organizationId), isNull(creditBatches.archivedAt)));
    await tx.update(stockpileEvents).set({ archivedAt }).where(and(eq(stockpileEvents.facilityId, facilityId), eq(stockpileEvents.organizationId, ctx.organizationId), isNull(stockpileEvents.archivedAt)));
    await tx.update(powerProcurementEvidence).set({ archivedAt }).where(and(eq(powerProcurementEvidence.facilityId, facilityId), eq(powerProcurementEvidence.organizationId, ctx.organizationId), isNull(powerProcurementEvidence.archivedAt)));

    return archived;
  });
}

/**
 * Restore an archived facility and all children archived by the cascade.
 */
export async function restoreFacility(
  ctx: OrgContext,
  facilityId: string
): Promise<Facility> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: facilities.id, archivedAt: facilities.archivedAt })
      .from(facilities)
      .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

    if (!existing) {
      throw new SafeError("Facility not found");
    }
    if (!existing.archivedAt) {
      throw new SafeError("Facility is not archived");
    }

    const archivedAt = null;

    const [restored] = await tx
      .update(facilities)
      .set({ archivedAt, updatedAt: new Date() })
      .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
      .returning();

    // The facility cascade is the only writer of archived_at, so restore clears
    // it on all children indiscriminately. If per-entity archive writers are
    // ever added, guard these updates with .where(isNull(<table>.archivedAt))
    // captured at archive time, or restore will un-archive individually
    // archived rows.
    await tx.update(reactors).set({ archivedAt }).where(and(eq(reactors.facilityId, facilityId), eq(reactors.organizationId, ctx.organizationId)));
    await tx.update(storageLocations).set({ archivedAt }).where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.organizationId, ctx.organizationId)));
    await tx.update(feedstockDeliveries).set({ archivedAt }).where(and(eq(feedstockDeliveries.facilityId, facilityId), eq(feedstockDeliveries.organizationId, ctx.organizationId)));
    await tx.update(feedstocks).set({ archivedAt }).where(and(eq(feedstocks.facilityId, facilityId), eq(feedstocks.organizationId, ctx.organizationId)));
    await tx.update(productionRuns).set({ archivedAt }).where(and(eq(productionRuns.facilityId, facilityId), eq(productionRuns.organizationId, ctx.organizationId)));
    await tx.update(biocharProducts).set({ archivedAt }).where(and(eq(biocharProducts.facilityId, facilityId), eq(biocharProducts.organizationId, ctx.organizationId)));
    await tx.update(orders).set({ archivedAt }).where(and(eq(orders.facilityId, facilityId), eq(orders.organizationId, ctx.organizationId)));
    await tx.update(deliveries).set({ archivedAt }).where(and(eq(deliveries.facilityId, facilityId), eq(deliveries.organizationId, ctx.organizationId)));
    await tx.update(creditBatches).set({ archivedAt }).where(and(eq(creditBatches.facilityId, facilityId), eq(creditBatches.organizationId, ctx.organizationId)));
    await tx.update(stockpileEvents).set({ archivedAt }).where(and(eq(stockpileEvents.facilityId, facilityId), eq(stockpileEvents.organizationId, ctx.organizationId)));
    await tx.update(powerProcurementEvidence).set({ archivedAt }).where(and(eq(powerProcurementEvidence.facilityId, facilityId), eq(powerProcurementEvidence.organizationId, ctx.organizationId)));

    return restored;
  });
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a facility code is available
 */
export async function isFacilityCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeFacilityId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(facilities.code, code), eq(facilities.organizationId, ctx.organizationId)];

  if (excludeFacilityId) {
    conditions.push(sql`${facilities.id} != ${excludeFacilityId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get unique countries for the facility filter dropdown. Scoped to the
 * collection being filtered — active facilities by default, archived when
 * `archived` is true — so the archived view can never show a country list
 * that excludes a visible archived facility's country.
 */
export async function getFacilityCountries(
  ctx: OrgContext,
  options?: { archived?: boolean },
): Promise<string[]> {
  requireOrgScope(ctx);

  const results = await db
    .selectDistinct({ country: facilities.country })
    .from(facilities)
    .where(
      and(
        eq(facilities.organizationId, ctx.organizationId),
        options?.archived
          ? isNotNull(facilities.archivedAt)
          : isNull(facilities.archivedAt),
      ),
    )
    .orderBy(asc(facilities.country));

  return results.map((r) => r.country);
}
