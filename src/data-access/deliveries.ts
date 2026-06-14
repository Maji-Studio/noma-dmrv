/**
 * Deliveries Data Access Layer
 * CRUD operations for deliveries with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, sql, SQL, count, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  deliveries,
  orders,
  facilities,
  customers,
  applications,
  biocharProducts,
  drivers,
  vehicles,
  type Delivery,
} from "@/db/schema";
import type { DeliveryFilterData, DeliveryStatus } from "@/schemas/deliveries";

// ============================================
// Types
// ============================================

export interface DeliveryWithRelations extends Delivery {
  status: DeliveryStatus;
  orderCode: string | null;
  facilityName: string | null;
  customerName: string | null;
  biocharProductCode: string | null;
  driverName: string | null;
  vehicleName: string | null;
}

export interface PaginatedDeliveries {
  items: DeliveryWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DeliveryDetail extends Delivery {
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

export interface DeliveryStats {
  totalDeliveries: number;
  totalDeliveredWetMassKg: number;
  totalMassDryKg: number;
  upcomingCount: number;
  deliveredCount: number;
}

// ============================================
// Auth Guards
// ============================================

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";

// ============================================
// Read Operations
// ============================================

type DeliveryColumnAvailability = {
  truckMassOnArrivalKg: boolean;
  truckMassOnDepartureKg: boolean;
  distanceKmOverride: boolean;
  distanceSource: boolean;
  distanceNote: boolean;
  archivedAt: boolean;
};

let deliveryColumnAvailabilityPromise: Promise<DeliveryColumnAvailability> | null = null;

async function getDeliveryColumnAvailability(): Promise<DeliveryColumnAvailability> {
  if (!deliveryColumnAvailabilityPromise) {
    deliveryColumnAvailabilityPromise = db
      .execute<{ column_name: string }>(sql`
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'deliveries'
          and column_name in (
            'truck_mass_on_arrival_kg',
            'truck_mass_on_departure_kg',
            'distance_km_override',
            'distance_source',
            'distance_note',
            'archived_at'
          )
      `)
      .then(({ rows }) => {
        const columns = new Set(rows.map((row) => row.column_name));

        return {
          truckMassOnArrivalKg: columns.has("truck_mass_on_arrival_kg"),
          truckMassOnDepartureKg: columns.has("truck_mass_on_departure_kg"),
          distanceKmOverride: columns.has("distance_km_override"),
          distanceSource: columns.has("distance_source"),
          distanceNote: columns.has("distance_note"),
          archivedAt: columns.has("archived_at"),
        };
      });
  }

  return deliveryColumnAvailabilityPromise;
}

function getDeliveryBaseSelection(columns: DeliveryColumnAvailability) {
  return {
    id: deliveries.id,
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
    truckMassOnArrivalKg: columns.truckMassOnArrivalKg
      ? deliveries.truckMassOnArrivalKg
      : sql<number | null>`null`.as("truck_mass_on_arrival_kg"),
    truckMassOnDepartureKg: columns.truckMassOnDepartureKg
      ? deliveries.truckMassOnDepartureKg
      : sql<number | null>`null`.as("truck_mass_on_departure_kg"),
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
function activeDeliveriesCondition(columns: DeliveryColumnAvailability): SQL[] {
  return columns.archivedAt ? [isNull(deliveries.archivedAt)] : [];
}

/**
 * Get all deliveries with pagination and filtering
 */
export async function getDeliveries(
  userId: string,
  filters?: Partial<DeliveryFilterData>
): Promise<PaginatedDeliveries> {
  requireAuth(userId);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const {
    search,
    orderId,
    facilityId,
    status,
    fromDate,
    toDate,
    page = 1,
    pageSize = 20,
    sortBy = "deliveryDate",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions — archived deliveries (facility archive cascade) are hidden
  const conditions: SQL[] = [...activeDeliveriesCondition(deliveryColumns)];

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
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(deliveries)
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
    })
    .from(deliveries)
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .leftJoin(facilities, eq(deliveries.facilityId, facilities.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(biocharProducts, eq(deliveries.biocharProductId, biocharProducts.id))
    .leftJoin(drivers, eq(deliveries.driverId, drivers.id))
    .leftJoin(vehicles, eq(deliveries.vehicleId, vehicles.id))
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
  userId: string,
  deliveryId: string
): Promise<Delivery> {
  requireAuth(userId);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const [delivery] = await db
    .select(getDeliveryBaseSelection(deliveryColumns))
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  if (!delivery) {
    throw new SafeError("Delivery not found");
  }

  return delivery;
}

export async function getDeliveriesByIds(
  userId: string,
  deliveryIds: string[],
): Promise<
  {
    id: string;
    code: string;
    truckMassOnArrivalKg: number | null;
    truckMassOnDepartureKg: number | null;
  }[]
> {
  requireAuth(userId);
  if (deliveryIds.length === 0) return [];

  const deliveryColumns = await getDeliveryColumnAvailability();
  const baseSelection = getDeliveryBaseSelection(deliveryColumns);

  return db
    .select({
      id: deliveries.id,
      code: deliveries.code,
      truckMassOnArrivalKg: baseSelection.truckMassOnArrivalKg,
      truckMassOnDepartureKg: baseSelection.truckMassOnDepartureKg,
    })
    .from(deliveries)
    .where(inArray(deliveries.id, deliveryIds));
}

/**
 * Get a single delivery with all its relationships
 */
export async function getDeliveryWithRelations(
  userId: string,
  deliveryId: string
): Promise<DeliveryDetail> {
  requireAuth(userId);
  const deliveryColumns = await getDeliveryColumnAvailability();

  // Get delivery with related data
  const [deliveryRow] = await db
    .select({
      ...getDeliveryBaseSelection(deliveryColumns),
      orderCode: orders.code,
      orderDate: orders.orderDate,
      orderQuantityKg: orders.quantityKg,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      biocharProductCode: biocharProducts.code,
      driverName: drivers.name,
      vehicleName: vehicles.name,
      vehicleIdentifier: vehicles.identifier,
    })
    .from(deliveries)
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .leftJoin(facilities, eq(deliveries.facilityId, facilities.id))
    .leftJoin(biocharProducts, eq(deliveries.biocharProductId, biocharProducts.id))
    .leftJoin(drivers, eq(deliveries.driverId, drivers.id))
    .leftJoin(vehicles, eq(deliveries.vehicleId, vehicles.id))
    .where(eq(deliveries.id, deliveryId));

  if (!deliveryRow) {
    throw new SafeError("Delivery not found");
  }

  return {
    id: deliveryRow.id,
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
    truckMassOnArrivalKg: deliveryRow.truckMassOnArrivalKg,
    truckMassOnDepartureKg: deliveryRow.truckMassOnDepartureKg,
    distanceKmOverride: deliveryRow.distanceKmOverride,
    distanceSource: deliveryRow.distanceSource,
    distanceNote: deliveryRow.distanceNote,
    driverId: deliveryRow.driverId,
    vehicleId: deliveryRow.vehicleId,
    archivedAt: deliveryRow.archivedAt,
    createdAt: deliveryRow.createdAt,
    updatedAt: deliveryRow.updatedAt,
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
 * Get delivery statistics
 */
export async function getDeliveryStats(
  userId: string,
  filters?: { facilityId?: string; fromDate?: Date; toDate?: Date }
): Promise<DeliveryStats> {
  requireAuth(userId);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const conditions: SQL[] = [...activeDeliveriesCondition(deliveryColumns)];

  if (filters?.facilityId) {
    conditions.push(eq(deliveries.facilityId, filters.facilityId));
  }

  if (filters?.fromDate) {
    conditions.push(gte(deliveries.deliveryDate, filters.fromDate));
  }

  if (filters?.toDate) {
    conditions.push(lte(deliveries.deliveryDate, filters.toDate));
  }

  const whereClause = and(...conditions);

  // Get aggregate stats
  const [stats] = await db
    .select({
      totalDeliveries: count(),
      totalDeliveredWetMassKg: sum(deliveries.deliveredWetMassKg),
      totalMassDryKg: sum(deliveries.massDryKg),
    })
    .from(deliveries)
    .where(whereClause);

  // Get counts by status
  const statusCounts = await db
    .select({
      status: deliveries.status,
      count: count(),
    })
    .from(deliveries)
    .where(whereClause)
    .groupBy(deliveries.status);

  const statusCountMap = new Map(
    statusCounts.map((s) => [s.status, Number(s.count)])
  );

  return {
    totalDeliveries: Number(stats.totalDeliveries),
    totalDeliveredWetMassKg: Number(stats.totalDeliveredWetMassKg) || 0,
    totalMassDryKg: Number(stats.totalMassDryKg) || 0,
    upcomingCount: statusCountMap.get("upcoming") ?? 0,
    deliveredCount: statusCountMap.get("delivered") ?? 0,
  };
}

/**
 * Get deliveries for dropdown selection
 */
export async function getDeliveriesForSelect(
  userId: string,
  orderId?: string
): Promise<Array<{ id: string; code: string; deliveryDate: Date; status: string; orderCode: string | null }>> {
  requireAuth(userId);
  const deliveryColumns = await getDeliveryColumnAvailability();

  const conditions: SQL[] = [...activeDeliveriesCondition(deliveryColumns)];
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
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
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
  userId: string,
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
    truckMassOnArrivalKg?: number | null;
    truckMassOnDepartureKg?: number | null;
    distanceKmOverride?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    distanceNote?: string | null;
  }
): Promise<Delivery> {
  requireAuth(userId);
  const deliveryColumns = await getDeliveryColumnAvailability();

  // Validate massDryKg <= deliveredWetMassKg
  if (
    data.massDryKg != null &&
    data.deliveredWetMassKg != null &&
    data.massDryKg > data.deliveredWetMassKg
  ) {
    throw new SafeError("Dry mass must be less than or equal to wet mass");
  }

  // Check for duplicate code
  const [existing] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(eq(deliveries.code, data.code));

  if (existing) {
    throw new SafeError("A delivery with this code already exists");
  }

  // Verify order exists
  const [order] = await db
    .select({ id: orders.id, facilityId: orders.facilityId, biocharProductId: orders.biocharProductId })
    .from(orders)
    .where(eq(orders.id, data.orderId));

  if (!order) {
    throw new SafeError("Order not found");
  }

  if (order.facilityId !== data.facilityId) {
    throw new SafeError("Order belongs to a different facility");
  }

  const effectiveBiocharProductId = data.biocharProductId ?? order.biocharProductId;
  if (effectiveBiocharProductId) {
    const [product] = await db
      .select({ facilityId: biocharProducts.facilityId })
      .from(biocharProducts)
      .where(eq(biocharProducts.id, effectiveBiocharProductId));

    if (!product) {
      throw new SafeError("Biochar product not found");
    }

    if (product.facilityId !== data.facilityId) {
      throw new SafeError("Biochar product belongs to a different facility");
    }
  }

  const [delivery] = await db
    .insert(deliveries)
    .values({
      code: data.code,
      orderId: data.orderId,
      facilityId: data.facilityId,
      deliveryDate: data.deliveryDate,
      biocharProductId: effectiveBiocharProductId ?? null,
      driverId: data.driverId ?? null,
      vehicleId: data.vehicleId ?? null,
      status: data.status ?? "upcoming",
      deliveredWetMassKg: data.deliveredWetMassKg ?? null,
      massDryKg: data.massDryKg ?? null,
      moistureContentPercent: data.moistureContentPercent ?? null,
      ...(deliveryColumns.truckMassOnArrivalKg
        ? { truckMassOnArrivalKg: data.truckMassOnArrivalKg ?? null }
        : {}),
      ...(deliveryColumns.truckMassOnDepartureKg
        ? { truckMassOnDepartureKg: data.truckMassOnDepartureKg ?? null }
        : {}),
      ...(deliveryColumns.distanceKmOverride
        ? { distanceKmOverride: data.distanceKmOverride ?? null }
        : {}),
      ...(deliveryColumns.distanceSource
        ? { distanceSource: data.distanceSource ?? null }
        : {}),
      ...(deliveryColumns.distanceNote
        ? { distanceNote: data.distanceNote ?? null }
        : {}),
    })
    .returning(getDeliveryBaseSelection(deliveryColumns));

  return delivery;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing delivery
 */
export async function updateDelivery(
  userId: string,
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
    truckMassOnArrivalKg?: number | null;
    truckMassOnDepartureKg?: number | null;
    distanceKmOverride?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    distanceNote?: string | null;
  }
): Promise<Delivery> {
  requireAuth(userId);
  const deliveryColumns = await getDeliveryColumnAvailability();

  // Verify delivery exists
  const [existing] = await db
    .select(getDeliveryBaseSelection(deliveryColumns))
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

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
      .where(eq(deliveries.code, data.code));

    if (duplicate) {
      throw new SafeError("A delivery with this code already exists");
    }
  }

  const effectiveFacilityId = data.facilityId ?? existing.facilityId;
  const effectiveOrderId = data.orderId ?? existing.orderId;

  if (data.facilityId !== undefined || data.orderId !== undefined) {
    const [order] = await db
      .select({ facilityId: orders.facilityId })
      .from(orders)
      .where(eq(orders.id, effectiveOrderId));

    if (!order) {
      throw new SafeError("Order not found");
    }

    if (order.facilityId !== effectiveFacilityId) {
      throw new SafeError("Order belongs to a different facility");
    }
  }

  const effectiveBiocharProductId = data.biocharProductId ?? existing.biocharProductId;
  if (
    effectiveBiocharProductId &&
    (data.facilityId !== undefined || data.biocharProductId !== undefined)
  ) {
    const [product] = await db
      .select({ facilityId: biocharProducts.facilityId })
      .from(biocharProducts)
      .where(eq(biocharProducts.id, effectiveBiocharProductId));

    if (!product) {
      throw new SafeError("Biochar product not found");
    }

    if (product.facilityId !== effectiveFacilityId) {
      throw new SafeError("Biochar product belongs to a different facility");
    }
  }

  const updated = await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "delivery", entityId: deliveryId },
      "update",
    );

    const [row] = await tx
      .update(deliveries)
      .set({
        ...data,
        ...(deliveryColumns.truckMassOnArrivalKg
          ? {}
          : { truckMassOnArrivalKg: undefined }),
        ...(deliveryColumns.truckMassOnDepartureKg
          ? {}
          : { truckMassOnDepartureKg: undefined }),
        ...(deliveryColumns.distanceKmOverride
          ? {}
          : { distanceKmOverride: undefined }),
        ...(deliveryColumns.distanceSource
          ? {}
          : { distanceSource: undefined }),
        ...(deliveryColumns.distanceNote
          ? {}
          : { distanceNote: undefined }),
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, deliveryId))
      .returning(getDeliveryBaseSelection(deliveryColumns));

    return row;
  });

  return updated;
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a delivery
 */
export async function deleteDelivery(
  userId: string,
  deliveryId: string
): Promise<void> {
  requireAuth(userId);

  // Verify delivery exists
  const [existing] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  if (!existing) {
    throw new SafeError("Delivery not found");
  }

  await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "delivery", entityId: deliveryId },
      "delete",
    );

    const [{ value: applicationCount }] = await tx
      .select({ value: count() })
      .from(applications)
      .where(eq(applications.deliveryId, deliveryId));

    if (Number(applicationCount) > 0) {
      throw new SafeError(
        "Cannot delete delivery with applications. Remove the applications first."
      );
    }

    await tx.delete(deliveries).where(eq(deliveries.id, deliveryId));
  });
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a delivery code is available
 */
export async function isDeliveryCodeAvailable(
  userId: string,
  code: string,
  excludeDeliveryId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(deliveries.code, code)];

  if (excludeDeliveryId) {
    conditions.push(sql`${deliveries.id} != ${excludeDeliveryId}`);
  }

  const [existing] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(...conditions));

  return !existing;
}
