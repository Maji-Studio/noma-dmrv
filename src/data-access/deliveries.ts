/**
 * Deliveries Data Access Layer
 * CRUD operations for deliveries with auth guards, pagination, and filtering
 */

import { db } from "@/db";
import {
  biocharProducts,
  customerLocations,
  customers,
  deliveries,
  drivers,
  facilities,
  orders,
  vehicles,
  type Delivery
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { DeliveryFilterData, DeliveryStatus } from "@/schemas/deliveries";
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, sql, SQL } from "drizzle-orm";
import {
  effectiveDeliveryDistanceKm,
  effectiveDeliveryDistanceSource,
} from "./delivery-distance-projections";
import { transportEvidenceDocumentCount } from "./transport-evidence-projections";
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
import { SafeError } from "@/lib/errors";
import { inDeliveryCreditBatchLineage } from "./credit-batch-lineage-filter";
import { requireOrgScope } from "./utils";

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
      inDeliveryCreditBatchLineage(
        ctx,
        creditBatchId,
        deliveries.id,
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

// ============================================
// Create Operations
// ============================================

/**
 * Create a new delivery
 */
export { createDelivery, deleteDelivery, updateDelivery } from './delivery-output-writes';
