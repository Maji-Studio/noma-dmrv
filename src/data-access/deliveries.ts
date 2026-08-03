/**
 * Deliveries Data Access Layer
 * CRUD operations for deliveries with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, sql, SQL, count } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import {
  deliveries,
  orders,
  facilities,
  customers,
  customerLocations,
  applications,
  biocharProducts,
  drivers,
  vehicles,
  type Delivery,
} from "@/db/schema";
import type { DeliveryFilterData, DeliveryStatus } from "@/schemas/deliveries";
import {
  effectiveDeliveryDistanceKm,
  effectiveDeliveryDistanceSource,
} from "./delivery-distance-projections";
import { transportEvidenceDocumentCount } from "./transport-evidence-projections";

// Types
export interface DeliveryWithRelations extends Delivery {
  status: DeliveryStatus;
  orderCode: string | null;
  facilityName: string | null;
  customerName: string | null;
  biocharProductCode: string | null;
  driverName: string | null;
  vehicleName: string | null;
  effectiveDistanceKm: number | null;
  effectiveDistanceSource: "map_estimate" | "manual" | "document" | null;
  transportEvidenceDocumentCount: number;
}

export interface PaginatedDeliveries {
  items: DeliveryWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DeliveryDetail extends Delivery {
  effectiveDistanceKm: number | null;
  effectiveDistanceSource: "map_estimate" | "manual" | "document" | null;
  transportEvidenceDocumentCount: number;
  customerName: string | null;
  order: {
    id: string;
    code: string;
    orderDate: Date;
    quantityKg: number;
  } | null;
  facility: {
    id: string;
    code: string;
    name: string;
  } | null;
  biocharProduct: {
    id: string;
    code: string;
  } | null;
  driver: {
    id: string;
    name: string;
  } | null;
  vehicle: {
    id: string;
    name: string;
    identifier: string;
  } | null;
}

// Auth guards
import { assertSameOrg, requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import {
  retireDocumentsForEntities,
  type DocumentEntityRef,
} from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import {
  deliveryDrawsStock,
  lockCreateDeliveryStock,
  lockDeleteDeliveryStock,
  lockDeliveryUpdateStock,
} from "./delivery-stock-locks";
import {
  assertDeliveryWithinOrderBalance,
  lockDeliveryOrderAndAssertBalance,
} from "./delivery-order-balance";
import {
  lockBiocharTransportRouteTopology,
  syncBiocharProductTransportLegs,
} from "./transport-legs";
import { inCreditBatchLineage } from "./credit-batch-lineage-filter";
import { isStockOverdraw } from "@/lib/stock-overdraw";

// ============================================
// Read Operations
// ============================================

export type DeliveryColumnAvailability = {
  distanceKmOverride: boolean;
  distanceSource: boolean;
  distanceNote: boolean;
  tripType: boolean;
  archivedAt: boolean;
};

let deliveryColumnAvailabilityPromise: Promise<DeliveryColumnAvailability> | null = null;

export async function getDeliveryColumnAvailability(): Promise<DeliveryColumnAvailability> {
  if (!deliveryColumnAvailabilityPromise) {
    deliveryColumnAvailabilityPromise = db
      .execute<{ column_name: string }>(sql`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'deliveries'
          and column_name in (
            'distance_km_override',
            'distance_source',
            'distance_note',
            'trip_type',
            'archived_at'
          )
      `)
      .then(({ rows }) => {
        const columns = new Set(rows.map((row) => row.column_name));

        return {
          distanceKmOverride: columns.has("distance_km_override"),
          distanceSource: columns.has("distance_source"),
          distanceNote: columns.has("distance_note"),
          tripType: columns.has("trip_type"),
          archivedAt: columns.has("archived_at"),
        };
      });
  }

  return deliveryColumnAvailabilityPromise;
}

function getDeliveryBaseSelection(columns: DeliveryColumnAvailability) {
  return {
    id: deliveries.id,
    organizationId: deliveries.organizationId,
    code: deliveries.code,
    facilityId: deliveries.facilityId,
    orderId: deliveries.orderId,
    customerLocationId: deliveries.customerLocationId,
    biocharProductId: deliveries.biocharProductId,
    storageLocationId: deliveries.storageLocationId,
    biocharStorageInventoryId: deliveries.biocharStorageInventoryId,
    deliveryDate: deliveries.deliveryDate,
    status: deliveries.status,
    deliveredWetMassKg: deliveries.deliveredWetMassKg,
    massDryKg: deliveries.massDryKg,
    moistureContentPercent: deliveries.moistureContentPercent,
    distanceKmOverride: columns.distanceKmOverride
      ? deliveries.distanceKmOverride
      : sql<number | null>`null`.as("distance_km_override"),
    distanceSource: columns.distanceSource
      ? deliveries.distanceSource
      : sql<"map_estimate" | "manual" | "document" | null>`null`.as(
          "distance_source"
        ),
    distanceNote: columns.distanceNote
      ? deliveries.distanceNote
      : sql<string | null>`null`.as("distance_note"),
    tripType: columns.tripType
      ? deliveries.tripType
      : sql<"return" | "one_way">`'return'`.as("trip_type"),
    driverId: deliveries.driverId,
    vehicleId: deliveries.vehicleId,
    archivedAt: columns.archivedAt
      ? deliveries.archivedAt
      : sql<Date | null>`null`.as("archived_at"),
    createdAt: deliveries.createdAt,
    updatedAt: deliveries.updatedAt,
  };
}

/** Archived-row filter, skipped while the column has not been migrated yet. */
export function activeDeliveriesCondition(columns: DeliveryColumnAvailability): SQL[] {
  return columns.archivedAt ? [isNull(deliveries.archivedAt)] : [];
}

/**
 * Get all deliveries with pagination and filtering
 */
export async function getDeliveries(
  ctx: OrgContext,
  filters?: Partial<DeliveryFilterData>
): Promise<PaginatedDeliveries> {
  requireOrgScope(ctx);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const {
    search,
    orderId,
    facilityId,
    creditBatchId,
    status,
    fromDate,
    toDate,
    page = 1,
    pageSize = 20,
    sortBy = "deliveryDate",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions — archived deliveries (facility archive cascade) are hidden
  const conditions: SQL[] = [
    eq(deliveries.organizationId, ctx.organizationId),
    ...activeDeliveriesCondition(deliveryColumns),
  ];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(deliveries.code, searchPattern));
  }

  if (orderId) {
    conditions.push(eq(deliveries.orderId, orderId));
  }

  if (facilityId) {
    conditions.push(eq(deliveries.facilityId, facilityId));
  }

  if (creditBatchId) {
    conditions.push(
      inCreditBatchLineage(
        ctx,
        creditBatchId,
        sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
      ),
    );
  }

  if (status) {
    conditions.push(eq(deliveries.status, status));
  }

  if (fromDate) {
    conditions.push(gte(deliveries.deliveryDate, fromDate));
  }

  if (toDate) {
    conditions.push(lte(deliveries.deliveryDate, toDate));
  }

  const whereClause = and(...conditions);

  // Build sort clause
  const sortColumn = {
    code: deliveries.code,
    deliveryDate: deliveries.deliveryDate,
    deliveredWetMassKg: deliveries.deliveredWetMassKg,
    massDryKg: deliveries.massDryKg,
    status: deliveries.status,
    createdAt: deliveries.createdAt,
    updatedAt: deliveries.updatedAt,
  }[sortBy] ?? deliveries.deliveryDate;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  // org-scope-ok: whereClause includes the active organization predicate.
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(deliveries)
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get deliveries with related entity names
  const deliveryList = await db
    .select({
      ...getDeliveryBaseSelection(deliveryColumns),
      orderCode: orders.code,
      facilityName: facilities.name,
      customerName: customers.name,
      biocharProductCode: biocharProducts.code,
      driverName: drivers.name,
      vehicleName: vehicles.name,
      effectiveDistanceKm: effectiveDeliveryDistanceKm(deliveryColumns),
      effectiveDistanceSource: effectiveDeliveryDistanceSource(deliveryColumns),
      transportEvidenceDocumentCount: transportEvidenceDocumentCount(
        ctx.organizationId,
        "delivery",
        "deliveryId",
      ),
    })
    .from(deliveries)
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(facilities, and(eq(deliveries.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
    .leftJoin(
      customerLocations,
      and(
        eq(
          customerLocations.id,
          sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
        ),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(biocharProducts, and(eq(deliveries.biocharProductId, biocharProducts.id), eq(biocharProducts.organizationId, ctx.organizationId)))
    .leftJoin(drivers, and(eq(deliveries.driverId, drivers.id), eq(drivers.organizationId, ctx.organizationId)))
    .leftJoin(vehicles, and(eq(deliveries.vehicleId, vehicles.id), eq(vehicles.organizationId, ctx.organizationId)))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  return {
    items: deliveryList,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single delivery by ID
 */
export async function getDeliveryById(
  ctx: OrgContext,
  deliveryId: string
): Promise<Delivery> {
  requireOrgScope(ctx);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const [delivery] = await db
    .select(getDeliveryBaseSelection(deliveryColumns))
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));

  if (!delivery) {
    throw new SafeError("Delivery not found");
  }

  return delivery;
}

/**
 * Get a single delivery with all its relationships
 */
export async function getDeliveryWithRelations(
  ctx: OrgContext,
  deliveryId: string
): Promise<DeliveryDetail> {
  requireOrgScope(ctx);
  const deliveryColumns = await getDeliveryColumnAvailability();

  // Get delivery with related data
  const [deliveryRow] = await db
    .select({
      ...getDeliveryBaseSelection(deliveryColumns),
      orderCode: orders.code,
      orderDate: orders.orderDate,
      orderQuantityKg: orders.quantityKg,
      customerName: customers.name,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      biocharProductCode: biocharProducts.code,
      driverName: drivers.name,
      vehicleName: vehicles.name,
      vehicleIdentifier: vehicles.identifier,
      effectiveDistanceKm: effectiveDeliveryDistanceKm(deliveryColumns),
      effectiveDistanceSource: effectiveDeliveryDistanceSource(deliveryColumns),
      transportEvidenceDocumentCount: transportEvidenceDocumentCount(
        ctx.organizationId,
        "delivery",
        "deliveryId",
      ),
    })
    .from(deliveries)
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
    .leftJoin(
      customerLocations,
      and(
        eq(
          customerLocations.id,
          sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
        ),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(facilities, and(eq(deliveries.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(biocharProducts, and(eq(deliveries.biocharProductId, biocharProducts.id), eq(biocharProducts.organizationId, ctx.organizationId)))
    .leftJoin(drivers, and(eq(deliveries.driverId, drivers.id), eq(drivers.organizationId, ctx.organizationId)))
    .leftJoin(vehicles, and(eq(deliveries.vehicleId, vehicles.id), eq(vehicles.organizationId, ctx.organizationId)))
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));

  if (!deliveryRow) {
    throw new SafeError("Delivery not found");
  }

  return {
    id: deliveryRow.id,
    organizationId: deliveryRow.organizationId,
    code: deliveryRow.code,
    facilityId: deliveryRow.facilityId,
    orderId: deliveryRow.orderId,
    customerLocationId: deliveryRow.customerLocationId,
    biocharProductId: deliveryRow.biocharProductId,
    storageLocationId: deliveryRow.storageLocationId,
    biocharStorageInventoryId: deliveryRow.biocharStorageInventoryId,
    deliveryDate: deliveryRow.deliveryDate,
    status: deliveryRow.status,
    deliveredWetMassKg: deliveryRow.deliveredWetMassKg,
    massDryKg: deliveryRow.massDryKg,
    moistureContentPercent: deliveryRow.moistureContentPercent,
    distanceKmOverride: deliveryRow.distanceKmOverride,
    distanceSource: deliveryRow.distanceSource,
    distanceNote: deliveryRow.distanceNote,
    tripType: deliveryRow.tripType,
    driverId: deliveryRow.driverId,
    vehicleId: deliveryRow.vehicleId,
    archivedAt: deliveryRow.archivedAt,
    createdAt: deliveryRow.createdAt,
    updatedAt: deliveryRow.updatedAt,
    effectiveDistanceKm: deliveryRow.effectiveDistanceKm,
    effectiveDistanceSource: deliveryRow.effectiveDistanceSource,
    transportEvidenceDocumentCount:
      deliveryRow.transportEvidenceDocumentCount,
    customerName: deliveryRow.customerName,
    order: deliveryRow.orderId
      ? {
          id: deliveryRow.orderId,
          code: deliveryRow.orderCode ?? "",
          orderDate: deliveryRow.orderDate ?? new Date(0),
          quantityKg: deliveryRow.orderQuantityKg ?? 0,
        }
      : null,
    facility: deliveryRow.facilityId
      ? {
          id: deliveryRow.facilityId,
          code: deliveryRow.facilityCode ?? "",
          name: deliveryRow.facilityName ?? "",
        }
      : null,
    biocharProduct: deliveryRow.biocharProductId
      ? {
          id: deliveryRow.biocharProductId,
          code: deliveryRow.biocharProductCode ?? "",
        }
      : null,
    driver: deliveryRow.driverId
      ? {
          id: deliveryRow.driverId,
          name: deliveryRow.driverName ?? "",
        }
      : null,
    vehicle: deliveryRow.vehicleId
      ? {
          id: deliveryRow.vehicleId,
          name: deliveryRow.vehicleName ?? "",
          identifier: deliveryRow.vehicleIdentifier ?? "",
        }
      : null,
  };
}

/**
 * Get deliveries for dropdown selection
 */
export async function getDeliveriesForSelect(
  ctx: OrgContext,
  orderId?: string
): Promise<Array<{ id: string; code: string; deliveryDate: Date; status: string; orderCode: string | null }>> {
  requireOrgScope(ctx);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const conditions: SQL[] = [eq(deliveries.organizationId, ctx.organizationId), ...activeDeliveriesCondition(deliveryColumns)];
  if (orderId) {
    conditions.push(eq(deliveries.orderId, orderId));
  }

  const whereClause = and(...conditions);

  return db
    .select({
      id: deliveries.id,
      code: deliveries.code,
      deliveryDate: deliveries.deliveryDate,
      status: deliveries.status,
      orderCode: orders.code,
    })
    .from(deliveries)
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .where(whereClause)
    .orderBy(desc(deliveries.deliveryDate));
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new delivery
 */
export async function createDelivery(
  ctx: OrgContext,
  data: {
    code: string;
    orderId: string;
    facilityId: string;
    deliveryDate: Date;
    biocharProductId?: string | null;
    driverId?: string | null;
    vehicleId?: string | null;
    status?: "upcoming" | "delivered";
    deliveredWetMassKg?: number | null;
    massDryKg?: number | null;
    moistureContentPercent?: number | null;
    distanceKmOverride?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    distanceNote?: string | null;
    tripType?: "return" | "one_way" | null;
  }
): Promise<Delivery> {
  requireOrgScope(ctx);
  const deliveryColumns = await getDeliveryColumnAvailability();

  // Validate massDryKg <= deliveredWetMassKg
  if (
    data.massDryKg != null &&
    data.deliveredWetMassKg != null &&
    data.massDryKg > data.deliveredWetMassKg
  ) {
    throw new SafeError("Dry mass must be less than or equal to wet mass");
  }

  const effectiveStatus = data.status ?? "upcoming";
  if (data.driverId) await assertSameOrg(ctx, drivers, data.driverId);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId);

  const delivery = await db.transaction(async (tx) => {
    await lockBiocharTransportRouteTopology(ctx, tx);

    const [order] = await tx
      .select({
        facilityId: orders.facilityId,
        biocharProductId: orders.biocharProductId,
      })
      .from(orders)
      .where(and(
        eq(orders.id, data.orderId),
        eq(orders.organizationId, ctx.organizationId),
      ));
    if (!order) {
      throw new SafeError("Order not found");
    }
    if (order.facilityId !== data.facilityId) {
      throw new SafeError("Order belongs to a different facility");
    }

    const effectiveBiocharProductId =
      data.biocharProductId ?? order.biocharProductId;
    const [product] = await tx
      .select({ facilityId: biocharProducts.facilityId })
      .from(biocharProducts)
      .where(and(
        eq(biocharProducts.id, effectiveBiocharProductId),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ));
    if (!product) {
      throw new SafeError("Biochar product not found");
    }
    if (product.facilityId !== data.facilityId) {
      throw new SafeError("Biochar product belongs to a different facility");
    }

    // Hard-block shipping more than the product batch physically holds (#116).
    if (deliveryDrawsStock(effectiveStatus, data.deliveredWetMassKg)) {
      await lockCreateDeliveryStock(ctx, tx, {
        biocharProductId: effectiveBiocharProductId,
        requestedWetKg: data.deliveredWetMassKg,
      });
    }

    // Upcoming rows allocate order quantity too. Lock the order after the
    // physical-stock tier, then derive the remaining balance transactionally.
    await lockDeliveryOrderAndAssertBalance(ctx, tx, {
      orderId: data.orderId,
      requestedWetKg: data.deliveredWetMassKg,
    });

    const [row] = await tx
      .insert(deliveries)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        orderId: data.orderId,
        facilityId: data.facilityId,
        deliveryDate: data.deliveryDate,
        biocharProductId: effectiveBiocharProductId,
        driverId: data.driverId ?? null,
        vehicleId: data.vehicleId ?? null,
        status: effectiveStatus,
        deliveredWetMassKg: data.deliveredWetMassKg ?? null,
        massDryKg: data.massDryKg ?? null,
        moistureContentPercent: data.moistureContentPercent ?? null,
        ...(deliveryColumns.distanceKmOverride
          ? { distanceKmOverride: data.distanceKmOverride ?? null }
          : {}),
        ...(deliveryColumns.distanceSource
          ? { distanceSource: data.distanceSource ?? null }
          : {}),
        ...(deliveryColumns.distanceNote
          ? { distanceNote: data.distanceNote ?? null }
          : {}),
        ...(deliveryColumns.tripType && data.tripType != null
          ? { tripType: data.tripType }
          : {}),
      })
      .returning(getDeliveryBaseSelection(deliveryColumns));

    await syncBiocharProductTransportLegs(ctx, tx, [
      effectiveBiocharProductId,
    ]);

    return row;
  });
  await processPendingStorageObjectDeletions(ctx);

  return delivery;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing delivery
 */
export async function updateDelivery(
  ctx: OrgContext,
  deliveryId: string,
  data: {
    code?: string;
    orderId?: string;
    facilityId?: string;
    deliveryDate?: Date;
    biocharProductId?: string | null;
    driverId?: string | null;
    vehicleId?: string | null;
    status?: "upcoming" | "delivered";
    deliveredWetMassKg?: number | null;
    massDryKg?: number | null;
    moistureContentPercent?: number | null;
    distanceKmOverride?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    distanceNote?: string | null;
    tripType?: "return" | "one_way" | null;
  }
): Promise<Delivery> {
  requireOrgScope(ctx);
  const deliveryColumns = await getDeliveryColumnAvailability();

  // Verify delivery exists
  const [existing] = await db
    .select(getDeliveryBaseSelection(deliveryColumns))
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Delivery not found");
  }

  // Validate massDryKg <= deliveredWetMassKg with merged data
  const finalWetMass = data.deliveredWetMassKg !== undefined
    ? data.deliveredWetMassKg
    : existing.deliveredWetMassKg;
  const finalDryMass = data.massDryKg !== undefined
    ? data.massDryKg
    : existing.massDryKg;

  if (
    finalDryMass != null &&
    finalWetMass != null &&
    finalDryMass > finalWetMass
  ) {
    throw new SafeError("Dry mass must be less than or equal to wet mass");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.code, data.code), eq(deliveries.organizationId, ctx.organizationId)));

    if (duplicate) {
      throw new SafeError("A delivery with this code already exists");
    }
  }

  const effectiveFacilityId = data.facilityId ?? existing.facilityId;
  const effectiveOrderId = data.orderId ?? existing.orderId;
  const orderIds = [...new Set([existing.orderId, effectiveOrderId])];
  const orderRows = await db
    .select({
      id: orders.id,
      facilityId: orders.facilityId,
      biocharProductId: orders.biocharProductId,
    })
    .from(orders)
    .where(and(
      inArray(orders.id, orderIds),
      eq(orders.organizationId, ctx.organizationId),
    ));
  const effectiveOrder = orderRows.find((order) => order.id === effectiveOrderId);

  if (!effectiveOrder) {
    throw new SafeError("Order not found");
  }

  if (data.facilityId !== undefined || data.orderId !== undefined) {
    if (effectiveOrder.facilityId !== effectiveFacilityId) {
      throw new SafeError("Order belongs to a different facility");
    }
  }

  const effectiveBiocharProductId = data.biocharProductId !== undefined
    ? data.biocharProductId ?? effectiveOrder.biocharProductId
    : existing.biocharProductId ?? effectiveOrder.biocharProductId;
  if (
    effectiveBiocharProductId &&
    (data.facilityId !== undefined ||
      data.biocharProductId !== undefined ||
      data.orderId !== undefined)
  ) {
    const [product] = await db
      .select({ facilityId: biocharProducts.facilityId })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.id, effectiveBiocharProductId), eq(biocharProducts.organizationId, ctx.organizationId)));

    if (!product) {
      throw new SafeError("Biochar product not found");
    }

    if (product.facilityId !== effectiveFacilityId) {
      throw new SafeError("Biochar product belongs to a different facility");
    }
  }

  if (data.driverId) await assertSameOrg(ctx, drivers, data.driverId);
  if (data.vehicleId) await assertSameOrg(ctx, vehicles, data.vehicleId);

  const updated = await db.transaction(async (tx) => {
    const routeMembershipCanChange =
      data.orderId !== undefined || data.biocharProductId !== undefined;
    if (routeMembershipCanChange) {
      await lockBiocharTransportRouteTopology(ctx, tx);
    }

    // Certified-lineage precedence: a verifier-bound delivery may not be edited
    // at all, so that refusal has to reach the operator ahead of any stock
    // complaint about an edit they were never allowed to make.
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "delivery", entityId: deliveryId },
      "update",
    );

    const lockedDelivery = await lockDeliveryUpdateStock(
      ctx,
      tx,
      deliveryId,
      data,
    );
    const lockedEffectiveOrderId = data.orderId ?? lockedDelivery.orderId;
    const lockedOrderIds = [...new Set([
      lockedDelivery.orderId,
      lockedEffectiveOrderId,
    ])];
    const lockedOrders = await tx
      .select({
        id: orders.id,
        biocharProductId: orders.biocharProductId,
        quantityKg: orders.quantityKg,
      })
      .from(orders)
      .where(and(
        inArray(orders.id, lockedOrderIds),
        eq(orders.organizationId, ctx.organizationId),
      ))
      .orderBy(orders.id)
      .for("update");
    const lockedExistingOrder = lockedOrders.find(
      (order) => order.id === lockedDelivery.orderId,
    );
    const lockedEffectiveOrder = lockedOrders.find(
      (order) => order.id === lockedEffectiveOrderId,
    );
    if (!lockedEffectiveOrder) {
      throw new SafeError("Order not found");
    }
    const lockedEffectiveWetMass =
      data.deliveredWetMassKg !== undefined
        ? data.deliveredWetMassKg
        : lockedDelivery.deliveredWetMassKg;
    const orderChanged = lockedEffectiveOrderId !== lockedDelivery.orderId;
    const wetMassIncreased =
      lockedEffectiveWetMass != null &&
      isStockOverdraw(
        lockedEffectiveWetMass,
        lockedDelivery.deliveredWetMassKg ?? 0,
      );
    if (
      orderChanged ||
      wetMassIncreased
    ) {
      await assertDeliveryWithinOrderBalance(ctx, tx, {
        orderId: lockedEffectiveOrderId,
        orderQuantityKg: lockedEffectiveOrder.quantityKg,
        requestedWetKg: lockedEffectiveWetMass,
        excludeDeliveryId: deliveryId,
      });
    }
    const lockedExistingBiocharProductId =
      lockedDelivery.biocharProductId ??
      lockedExistingOrder?.biocharProductId ??
      null;
    const lockedEffectiveBiocharProductId =
      data.biocharProductId !== undefined
        ? data.biocharProductId ?? lockedEffectiveOrder.biocharProductId
        : lockedDelivery.biocharProductId ??
          lockedEffectiveOrder.biocharProductId;

    const [row] = await tx
      .update(deliveries)
      .set({
        ...data,
        ...(deliveryColumns.distanceKmOverride
          ? {}
          : { distanceKmOverride: undefined }),
        ...(deliveryColumns.distanceSource
          ? {}
          : { distanceSource: undefined }),
        ...(deliveryColumns.distanceNote
          ? {}
          : { distanceNote: undefined }),
        // Null/absent tripType leaves the stored value untouched (Drizzle drops
        // undefined keys); strip entirely when the column is not yet migrated.
        ...(deliveryColumns.tripType && data.tripType != null
          ? { tripType: data.tripType }
          : { tripType: undefined }),
        updatedAt: new Date(),
      })
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)))
      .returning(getDeliveryBaseSelection(deliveryColumns));

    await syncBiocharProductTransportLegs(ctx, tx, [
      lockedExistingBiocharProductId,
      lockedEffectiveBiocharProductId,
    ]);

    return row;
  });
  await processPendingStorageObjectDeletions(ctx);

  return updated;
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a delivery
 */
export async function deleteDelivery(
  ctx: OrgContext,
  deliveryId: string
): Promise<void> {
  requireOrgScope(ctx);

  await db.transaction(async (tx) => {
    await lockBiocharTransportRouteTopology(ctx, tx);

    // Same precedence as updateDelivery: refuse the locked-lineage delete before
    // taking stock locks or complaining about stock.
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "delivery", entityId: deliveryId },
      "delete",
    );

    const locked = await lockDeleteDeliveryStock(ctx, tx, deliveryId);
    const [lockedOrder] = await tx
      .select({ biocharProductId: orders.biocharProductId })
      .from(orders)
      .where(and(
        eq(orders.id, locked.orderId),
        eq(orders.organizationId, ctx.organizationId),
      ));
    const affectedBiocharProductId =
      locked.biocharProductId ?? lockedOrder?.biocharProductId ?? null;
    const deferredRetirements: DocumentEntityRef[] = [];

    const [{ value: applicationCount }] = await tx
      .select({ value: count() })
      .from(applications)
      .where(and(eq(applications.deliveryId, deliveryId), eq(applications.organizationId, ctx.organizationId)));

    if (Number(applicationCount) > 0) {
      throw new SafeError(
        "Cannot delete delivery with applications. Remove the applications first."
      );
    }

    await tx.delete(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));
    await syncBiocharProductTransportLegs(ctx, tx, [
      affectedBiocharProductId,
    ], deferredRetirements);
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "delivery", entityId: deliveryId },
      ...deferredRetirements,
    ]);
  });
  await processPendingStorageObjectDeletions(ctx);
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a delivery code is available
 */
export async function isDeliveryCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeDeliveryId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.code, code)];

  if (excludeDeliveryId) {
    conditions.push(sql`${deliveries.id} != ${excludeDeliveryId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(...conditions));

  return !existing;
}
