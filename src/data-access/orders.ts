/**
 * Orders Data Access Layer
 * CRUD operations for orders with auth guards, pagination, and filtering
 */

import { db } from "@/db";
import { countRows, numericAggregate } from "@/db/aggregate";
import {
  customerLocations,
  customers,
  deliveries,
  facilities,
  formulations,
  orders,
  type Order
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  deriveOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
} from "@/lib/orders/fulfillment";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { OrderFilterData } from "@/schemas/orders";
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, sql, SQL } from "drizzle-orm";

// ============================================
// Types
// ============================================

export interface OrderWithRelations extends Order {
  facilityName: string | null;
  customerName: string | null;
  customerLocationName: string | null;
  formulationName: string | null;

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

// ============================================
// Auth Guards
// ============================================

import { SafeError } from "@/lib/errors";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { assertOrderQuantityCoversAllocations } from "./delivery-order-balance";
import { retireDocumentsForEntities } from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import {
  lockBiocharTransportRouteTopology
} from "./transport-legs";
import { assertSameOrg, requireOrgScope } from "./utils";

// ============================================
// Read Operations
// ============================================

/**
 * Get all orders with pagination and filtering
 * Supports search, facility filter, customer filter, status filter, sorting, and pagination
 */
export async function getOrders(
  ctx: OrgContext,
  filters?: Partial<OrderFilterData>
): Promise<PaginatedOrders> {
  requireOrgScope(ctx);

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
      delivered: countRows(sql`${deliveries.status} = 'delivered'`).as(
        "delivery_delivered",
      ),
    })
    .from(deliveries)
    .where(and(
      isNull(deliveries.archivedAt),
      eq(deliveries.organizationId, ctx.organizationId),
    ))
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
  const conditions: SQL[] = [
    eq(orders.organizationId, ctx.organizationId),
    isNull(orders.archivedAt),
  ];

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
  // org-scope-ok: whereClause includes the active organization predicate.
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
      organizationId: orders.organizationId,
      code: orders.code,
      facilityId: orders.facilityId,
      customerId: orders.customerId,
      customerLocationId: orders.customerLocationId,
      formulationId: orders.formulationId,
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
      formulationName: formulations.name,

      deliveryCount: numericAggregate(
        sql<number>`coalesce(${deliveryAgg.total}, 0)`,
      ),
      deliveredCount: numericAggregate(
        sql<number>`coalesce(${deliveryAgg.delivered}, 0)`,
      ),
    })
    .from(orders)
    .leftJoin(facilities, and(eq(orders.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
    .leftJoin(customerLocations, and(eq(orders.customerLocationId, customerLocations.id), eq(customerLocations.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(orders.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .leftJoin(deliveryAgg, eq(orders.id, deliveryAgg.orderId))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Combine data — derive fulfillment status from the counts (single source of truth)
  const items: OrderWithRelations[] = orderList.map((o) => {
    const deliveryCount = o.deliveryCount;
    const deliveredCount = o.deliveredCount;
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
 * Get orders for dropdown selection
 */
export async function getOrdersForSelect(
  ctx: OrgContext,
  facilityId?: string
): Promise<
  Array<{
    id: string;
    code: string;
    orderDate: Date;
    customerName: string | null;
    formulationName: string | null;
    formulationId: string;
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
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(orders.organizationId, ctx.organizationId), isNull(orders.archivedAt)];
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
      formulationName: formulations.name,
      formulationId: orders.formulationId,
      quantityKg: orders.quantityKg,
      destinationGpsLatitude: customerLocations.gpsLatitude,
      destinationGpsLongitude: customerLocations.gpsLongitude,
      destinationDistanceKm: customerLocations.distanceFromFacilityKm,
      destinationDistanceSource: customerLocations.distanceSource,
    })
    .from(orders)
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(orders.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .leftJoin(customerLocations, and(eq(orders.customerLocationId, customerLocations.id), eq(customerLocations.organizationId, ctx.organizationId)))
    .where(whereClause)
    .orderBy(desc(orders.orderDate));
}

// ============================================
// Create Operations
// ============================================

async function validateCustomerLocationBelongsToCustomer(
  ctx: OrgContext,
  customerId: string,
  customerLocationId: string | null | undefined
): Promise<void> {
  if (!customerLocationId) return;

  const [location] = await db
    .select({ customerId: customerLocations.customerId })
    .from(customerLocations)
    .where(and(
      eq(customerLocations.id, customerLocationId),
      eq(customerLocations.organizationId, ctx.organizationId),
    ));

  if (!location) {
    throw new SafeError("Customer location not found");
  }

  if (location.customerId !== customerId) {
    throw new SafeError("Delivery location belongs to a different customer");
  }
}

/** Orders request a formulation and wet mass; they never reserve physical stock. */
export async function createOrder(ctx: OrgContext, data: {
  code: string; facilityId: string; customerId: string; customerLocationId?: string | null;
  formulationId: string; orderDate: Date; quantityKg: number; packaging: 'loose' | 'bagged'; value?: number | null; currency?: string;
}): Promise<Order> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, customers, data.customerId);
  await validateCustomerLocationBelongsToCustomer(ctx, data.customerId, data.customerLocationId);
  return db.transaction(async tx => {
    const [facility] = await tx.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, data.facilityId), isNull(facilities.archivedAt))).for('share');
    const [formulation] = await tx.select({ id: formulations.id }).from(formulations).where(and(eq(formulations.organizationId, ctx.organizationId), eq(formulations.id, data.formulationId))).for('share');
    if (!facility || !formulation) throw new SafeError('Choose an active facility and formulation.');
    const [order] = await tx.insert(orders).values({ ...data, organizationId: ctx.organizationId }).returning();
    return order;
  });
}
export async function updateOrder(ctx: OrgContext, orderId: string, data: Partial<Omit<Order, 'id' | 'organizationId' | 'createdAt' | 'archivedAt'>>): Promise<Order> {
  requireOrgScope(ctx);
  if (data.customerId) await assertSameOrg(ctx, customers, data.customerId);
  if (data.formulationId) await assertSameOrg(ctx, formulations, data.formulationId);
  return db.transaction(async tx => {
    await lockBiocharTransportRouteTopology(ctx, tx);
    const [existing] = await tx.select().from(orders).where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, orderId))).for('update');
    if (!existing) throw new SafeError('Order not found');
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'order', entityId: orderId }, 'update');
    const [delivery] = await tx.select({ code: deliveries.code }).from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.orderId, orderId)));
    if (delivery && ['formulationId', 'facilityId', 'customerId', 'customerLocationId'].some(key => key in data && data[key as keyof typeof data] !== existing[key as keyof Order])) throw new SafeError(`Order relationship is used by delivery ${delivery.code}.`);
    await validateCustomerLocationBelongsToCustomer(ctx, data.customerId ?? existing.customerId, data.customerLocationId === undefined ? existing.customerLocationId : data.customerLocationId);
    if (data.facilityId) {
      const [facility] = await tx.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, data.facilityId), isNull(facilities.archivedAt)));
      if (!facility) throw new SafeError('Facility not found or archived');
    }
    if (data.quantityKg !== undefined) await assertOrderQuantityCoversAllocations(ctx, tx, { orderId, orderQuantityKg: data.quantityKg });
    const [saved] = await tx.update(orders).set({ ...data, updatedAt: new Date() }).where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, orderId))).returning();
    return saved;
  });
}

export async function deleteOrder(
  ctx: OrgContext,
  orderId: string
): Promise<void> {
  requireOrgScope(ctx);

  // Verify order exists
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Order not found");
  }

  await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "order", entityId: orderId },
      "delete",
    );

    // Check for associated deliveries
    const [deliveryCount] = await tx
      .select({ count: count() })
      .from(deliveries)
      .where(and(eq(deliveries.orderId, orderId), eq(deliveries.organizationId, ctx.organizationId)));

    if (Number(deliveryCount.count) > 0) {
      throw new SafeError(
        "Cannot delete order with associated deliveries. Remove deliveries first."
      );
    }

    await tx.delete(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, ctx.organizationId)));
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "order", entityId: orderId },
    ]);
  });
  await processPendingStorageObjectDeletions(ctx);
}

// ============================================
// Utility Operations
// ============================================
