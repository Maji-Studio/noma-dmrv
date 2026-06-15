/**
 * Orders Data Access Layer
 * CRUD operations for orders with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, gte, ilike, isNull, lte, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  orders,
  facilities,
  customers,
  customerLocations,
  biocharProducts,
  deliveries,
  type Order,
} from "@/db/schema";
import type { OrderFilterData } from "@/schemas/orders";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import {
  deriveOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
} from "@/lib/orders/fulfillment";

// ============================================
// Types
// ============================================

export interface OrderWithRelations extends Order {
  facilityName: string | null;
  customerName: string | null;
  customerLocationName: string | null;
  biocharProductCode: string | null;
  /** Total deliveries linked to this order (non-archived). */
  deliveryCount: number;
  /** Deliveries in the `delivered` status — drives the `x/y delivered` progress. */
  deliveredCount: number;
  /** Fulfillment derived from delivery counts; see lib/orders/fulfillment. */
  fulfillmentStatus: OrderFulfillmentStatus;
}

export interface PaginatedOrders {
  items: OrderWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OrderDetail extends Order {
  facility: {
    id: string;
    code: string;
    name: string;
  } | null;
  customer: {
    id: string;
    code: string;
    name: string;
  } | null;
  customerLocation: {
    id: string;
    name: string;
  } | null;
  biocharProduct: {
    id: string;
    code: string;
  } | null;
  deliveries: Array<{
    id: string;
    code: string;
    deliveryDate: Date;
    status: string;
    deliveredWetMassKg: number | null;
    massDryKg: number | null;
  }>;
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

/**
 * Get all orders with pagination and filtering
 * Supports search, facility filter, customer filter, status filter, sorting, and pagination
 */
export async function getOrders(
  userId: string,
  filters?: Partial<OrderFilterData>
): Promise<PaginatedOrders> {
  requireAuth(userId);

  const {
    search,
    facilityId,
    customerId,
    status,
    fromDate,
    toDate,
    page = 1,
    pageSize = 20,
    sortBy = "orderDate",
    sortOrder = "desc",
  } = filters ?? {};

  // Per-order delivery aggregate (non-archived): total + delivered counts.
  // Powers both the `x/y delivered` progress and the derived fulfillment status.
  const deliveryAgg = db
    .select({
      orderId: deliveries.orderId,
      total: count().as("delivery_total"),
      delivered:
        sql<number>`count(*) filter (where ${deliveries.status} = 'delivered')`.as(
          "delivery_delivered",
        ),
    })
    .from(deliveries)
    .where(isNull(deliveries.archivedAt))
    .groupBy(deliveries.orderId)
    .as("delivery_agg");

  // SQL mirror of deriveOrderFulfillmentStatus — keep the two thresholds in sync.
  const fulfillmentExpr = sql<OrderFulfillmentStatus>`
    case
      when coalesce(${deliveryAgg.total}, 0) = 0 then 'no_deliveries'
      when coalesce(${deliveryAgg.delivered}, 0) = 0 then 'pending'
      when coalesce(${deliveryAgg.delivered}, 0) < coalesce(${deliveryAgg.total}, 0) then 'partial'
      else 'fulfilled'
    end
  `;

  // Build where conditions — archived orders (facility archive cascade) are hidden
  const conditions: SQL[] = [isNull(orders.archivedAt)];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(orders.code, searchPattern));
  }

  if (facilityId) {
    conditions.push(eq(orders.facilityId, facilityId));
  }

  if (customerId) {
    conditions.push(eq(orders.customerId, customerId));
  }

  if (status) {
    conditions.push(sql`(${fulfillmentExpr}) = ${status}`);
  }

  if (fromDate) {
    conditions.push(gte(orders.orderDate, fromDate));
  }

  if (toDate) {
    conditions.push(lte(orders.orderDate, toDate));
  }

  const whereClause = and(...conditions);

  // Build sort clause
  const sortColumn = {
    code: orders.code,
    orderDate: orders.orderDate,
    quantityKg: orders.quantityKg,
    createdAt: orders.createdAt,
    updatedAt: orders.updatedAt,
  }[sortBy] ?? orders.orderDate;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination. Join the aggregate so a status filter resolves;
  // the grouped subquery is one row per order, so count() stays accurate.
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(orders)
    .leftJoin(deliveryAgg, eq(orders.id, deliveryAgg.orderId))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get orders with related entity names + delivery aggregate
  const orderList = await db
    .select({
      id: orders.id,
      code: orders.code,
      facilityId: orders.facilityId,
      customerId: orders.customerId,
      customerLocationId: orders.customerLocationId,
      biocharProductId: orders.biocharProductId,
      orderDate: orders.orderDate,
      quantityKg: orders.quantityKg,
      packaging: orders.packaging,
      value: orders.value,
      currency: orders.currency,
      archivedAt: orders.archivedAt,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      facilityName: facilities.name,
      customerName: customers.name,
      customerLocationName: customerLocations.name,
      biocharProductCode: biocharProducts.code,
      deliveryCount: sql<number>`coalesce(${deliveryAgg.total}, 0)`,
      deliveredCount: sql<number>`coalesce(${deliveryAgg.delivered}, 0)`,
    })
    .from(orders)
    .leftJoin(facilities, eq(orders.facilityId, facilities.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(customerLocations, eq(orders.customerLocationId, customerLocations.id))
    .leftJoin(biocharProducts, eq(orders.biocharProductId, biocharProducts.id))
    .leftJoin(deliveryAgg, eq(orders.id, deliveryAgg.orderId))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Combine data — derive fulfillment status from the counts (single source of truth)
  const items: OrderWithRelations[] = orderList.map((o) => {
    const deliveryCount = Number(o.deliveryCount);
    const deliveredCount = Number(o.deliveredCount);
    return {
      ...o,
      deliveryCount,
      deliveredCount,
      fulfillmentStatus: deriveOrderFulfillmentStatus(deliveryCount, deliveredCount),
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single order by ID
 */
export async function getOrderById(
  userId: string,
  orderId: string
): Promise<Order> {
  requireAuth(userId);

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    throw new SafeError("Order not found");
  }

  return order;
}

/**
 * Get a single order with all its relationships
 */
export async function getOrderWithRelations(
  userId: string,
  orderId: string
): Promise<OrderDetail> {
  requireAuth(userId);

  // Get order with related data
  const [orderRow] = await db
    .select({
      id: orders.id,
      code: orders.code,
      facilityId: orders.facilityId,
      customerId: orders.customerId,
      customerLocationId: orders.customerLocationId,
      biocharProductId: orders.biocharProductId,
      orderDate: orders.orderDate,
      quantityKg: orders.quantityKg,
      packaging: orders.packaging,
      value: orders.value,
      currency: orders.currency,
      archivedAt: orders.archivedAt,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      customerCode: customers.code,
      customerName: customers.name,
      customerLocationName: customerLocations.name,
      biocharProductCode: biocharProducts.code,
    })
    .from(orders)
    .leftJoin(facilities, eq(orders.facilityId, facilities.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(customerLocations, eq(orders.customerLocationId, customerLocations.id))
    .leftJoin(biocharProducts, eq(orders.biocharProductId, biocharProducts.id))
    .where(eq(orders.id, orderId));

  if (!orderRow) {
    throw new SafeError("Order not found");
  }

  // Get associated deliveries
  const orderDeliveries = await db
    .select({
      id: deliveries.id,
      code: deliveries.code,
      deliveryDate: deliveries.deliveryDate,
      status: deliveries.status,
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      massDryKg: deliveries.massDryKg,
    })
    .from(deliveries)
    .where(eq(deliveries.orderId, orderId))
    .orderBy(desc(deliveries.deliveryDate));

  return {
    id: orderRow.id,
    code: orderRow.code,
    facilityId: orderRow.facilityId,
    customerId: orderRow.customerId,
    customerLocationId: orderRow.customerLocationId,
    biocharProductId: orderRow.biocharProductId,
    orderDate: orderRow.orderDate,
    quantityKg: orderRow.quantityKg,
    packaging: orderRow.packaging,
    value: orderRow.value,
    currency: orderRow.currency,
    archivedAt: orderRow.archivedAt,
    createdAt: orderRow.createdAt,
    updatedAt: orderRow.updatedAt,
    facility: orderRow.facilityId
      ? {
          id: orderRow.facilityId,
          code: orderRow.facilityCode ?? "",
          name: orderRow.facilityName ?? "",
        }
      : null,
    customer: orderRow.customerId
      ? {
          id: orderRow.customerId,
          code: orderRow.customerCode ?? "",
          name: orderRow.customerName ?? "",
        }
      : null,
    customerLocation: orderRow.customerLocationId
      ? {
          id: orderRow.customerLocationId,
          name: orderRow.customerLocationName ?? "",
        }
      : null,
    biocharProduct: orderRow.biocharProductId
      ? {
          id: orderRow.biocharProductId,
          code: orderRow.biocharProductCode ?? "",
        }
      : null,
    deliveries: orderDeliveries,
  };
}

/**
 * Get orders for dropdown selection
 */
export async function getOrdersForSelect(
  userId: string,
  facilityId?: string
): Promise<
  Array<{
    id: string;
    code: string;
    orderDate: Date;
    customerName: string | null;
    biocharProductCode: string | null;
    quantityKg: number;
    /** Destination (order's customer location) GPS. */
    destinationGpsLatitude: number | null;
    destinationGpsLongitude: number | null;
    /**
     * Destination's stored road distance + provenance — prefills the delivery
     * distance field (the derived transport leg already falls back to it).
     */
    destinationDistanceKm: number | null;
    destinationDistanceSource: DistanceSourceValue | null;
  }>
> {
  requireAuth(userId);

  const conditions: SQL[] = [isNull(orders.archivedAt)];
  if (facilityId) {
    conditions.push(eq(orders.facilityId, facilityId));
  }

  const whereClause = and(...conditions);

  return db
    .select({
      id: orders.id,
      code: orders.code,
      orderDate: orders.orderDate,
      customerName: customers.name,
      biocharProductCode: biocharProducts.code,
      quantityKg: orders.quantityKg,
      destinationGpsLatitude: customerLocations.gpsLatitude,
      destinationGpsLongitude: customerLocations.gpsLongitude,
      destinationDistanceKm: customerLocations.distanceFromFacilityKm,
      destinationDistanceSource: customerLocations.distanceSource,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(biocharProducts, eq(orders.biocharProductId, biocharProducts.id))
    .leftJoin(customerLocations, eq(orders.customerLocationId, customerLocations.id))
    .where(whereClause)
    .orderBy(desc(orders.orderDate));
}

// ============================================
// Create Operations
// ============================================

async function validateCustomerLocationBelongsToCustomer(
  customerId: string,
  customerLocationId: string | null | undefined
): Promise<void> {
  if (!customerLocationId) return;

  const [location] = await db
    .select({ customerId: customerLocations.customerId })
    .from(customerLocations)
    .where(eq(customerLocations.id, customerLocationId));

  if (!location) {
    throw new SafeError("Customer location not found");
  }

  if (location.customerId !== customerId) {
    throw new SafeError("Delivery location belongs to a different customer");
  }
}

/**
 * Create a new order
 */
export async function createOrder(
  userId: string,
  data: {
    code: string;
    facilityId: string;
    customerId: string;
    customerLocationId?: string | null;
    biocharProductId: string;
    orderDate: Date;
    quantityKg: number;
    packaging: "loose" | "bagged";
    value?: number | null;
    currency?: string;
  }
): Promise<Order> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.code, data.code));

  if (existing) {
    throw new SafeError("An order with this code already exists");
  }

  const [product] = await db
    .select({ facilityId: biocharProducts.facilityId })
    .from(biocharProducts)
    .where(eq(biocharProducts.id, data.biocharProductId));

  if (!product) {
    throw new SafeError("Biochar product not found");
  }

  if (product.facilityId !== data.facilityId) {
    throw new SafeError("Biochar product belongs to a different facility");
  }

  await validateCustomerLocationBelongsToCustomer(
    data.customerId,
    data.customerLocationId
  );

  try {
    const [order] = await db
      .insert(orders)
      .values({
        code: data.code,
        facilityId: data.facilityId,
        customerId: data.customerId,
        customerLocationId: data.customerLocationId,
        biocharProductId: data.biocharProductId,
        orderDate: data.orderDate,
        quantityKg: data.quantityKg,
        packaging: data.packaging,
        value: data.value ?? null,
        currency: data.currency ?? "TZS",
      })
      .returning();

    return order;
  } catch (error) {
    if (error instanceof Error && error.message.includes("unique")) {
      throw new SafeError("An order with this code already exists");
    }
    throw error;
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing order
 */
export async function updateOrder(
  userId: string,
  orderId: string,
  data: {
    code?: string;
    facilityId?: string;
    customerId?: string;
    customerLocationId?: string | null;
    biocharProductId?: string;
    orderDate?: Date;
    quantityKg?: number;
    packaging?: "loose" | "bagged";
    value?: number | null;
    currency?: string;
  }
): Promise<Order> {
  requireAuth(userId);

  // Verify order exists
  const [existing] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!existing) {
    throw new SafeError("Order not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.code, data.code));

    if (duplicate) {
      throw new SafeError("An order with this code already exists");
    }
  }

  const effectiveFacilityId = data.facilityId ?? existing.facilityId;
  const effectiveProductId = data.biocharProductId ?? existing.biocharProductId;
  const effectiveCustomerId = data.customerId ?? existing.customerId;
  const effectiveCustomerLocationId =
    data.customerLocationId !== undefined
      ? data.customerLocationId
      : existing.customerLocationId;

  if (
    (data.facilityId !== undefined || data.biocharProductId !== undefined) &&
    effectiveProductId
  ) {
    const [product] = await db
      .select({ facilityId: biocharProducts.facilityId })
      .from(biocharProducts)
      .where(eq(biocharProducts.id, effectiveProductId));

    if (!product) {
      throw new SafeError("Biochar product not found");
    }

    if (product.facilityId !== effectiveFacilityId) {
      throw new SafeError("Biochar product belongs to a different facility");
    }
  }

  if (data.customerId !== undefined || data.customerLocationId !== undefined) {
    await validateCustomerLocationBelongsToCustomer(
      effectiveCustomerId,
      effectiveCustomerLocationId
    );
  }

  const updated = await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "order", entityId: orderId },
      "update",
    );

    const [row] = await tx
      .update(orders)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
      .returning();
    return row;
  });

  return updated;
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete an order
 * Will fail if order has associated deliveries
 */
export async function deleteOrder(
  userId: string,
  orderId: string
): Promise<void> {
  requireAuth(userId);

  // Verify order exists
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!existing) {
    throw new SafeError("Order not found");
  }

  await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      tx,
      { entityType: "order", entityId: orderId },
      "delete",
    );

    // Check for associated deliveries
    const [deliveryCount] = await tx
      .select({ count: count() })
      .from(deliveries)
      .where(eq(deliveries.orderId, orderId));

    if (Number(deliveryCount.count) > 0) {
      throw new SafeError(
        "Cannot delete order with associated deliveries. Remove deliveries first."
      );
    }

    await tx.delete(orders).where(eq(orders.id, orderId));
  });
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if an order code is available
 */
export async function isOrderCodeAvailable(
  userId: string,
  code: string,
  excludeOrderId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(orders.code, code)];

  if (excludeOrderId) {
    conditions.push(sql`${orders.id} != ${excludeOrderId}`);
  }

  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(...conditions));

  return !existing;
}
