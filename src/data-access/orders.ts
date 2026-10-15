import type { ActivityEventInput } from "./activity-events";
import { assertRowVersion, nextVersion, staleRowVersion } from "./row-version";
/**
 * Orders Data Access Layer
 * CRUD operations for orders with auth guards, pagination, and filtering
 */

import { db, type DbTransaction } from "@/db";
import { numericAggregate } from "@/db/aggregate";
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
import type { OrderFulfillmentStatus } from "@/lib/orders/fulfillment";
import { orderFulfillmentExpression } from "./order-fulfillment-sql";
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
  /** Wet mass of the deliveries in the `delivered` status, in kg. */
  deliveredWetMassKg: number;
  /** Fulfillment derived in SQL from delivered against requested wet mass (`getOrders`). */
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
import { orderArchived, orderCustomerLocationMismatch, orderHasDeliveries, orderReferenceNotFound, orderRelationshipFrozen, type OrderRelationshipField } from "@/lib/order-domain-errors";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "./code-generator";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { assertOrderQuantityCoversAllocations } from "./delivery-order-balance";
import { retireDocumentsForEntities } from "./documents";
import {
  lockBiocharTransportRouteTopology
} from "./transport-legs";
import { requireOrgScope } from "./utils";

// ============================================
// Read Operations
// ============================================

/**
 * The list row shape: an order with related entity names and its delivery
 * aggregate (non-archived deliveries), which powers the derived fulfillment
 * status. Shared by the list and the by-id read so the sheet sees one shape.
 */
function orderRowsQuery(ctx: OrgContext) {
  requireOrgScope(ctx);
  const deliveryAgg = db
    .select({
      orderId: deliveries.orderId,
      total: count().as("delivery_total"),
      deliveredWetKg: sql<number>`coalesce(sum(${deliveries.deliveredWetMassKg}) filter (where ${deliveries.status} = 'delivered'), 0)`.as(
        "delivery_delivered_wet_kg",
      ),
    })
    .from(deliveries)
    .where(and(
      isNull(deliveries.archivedAt),
      eq(deliveries.organizationId, ctx.organizationId),
    ))
    .groupBy(deliveries.orderId)
    .as("delivery_agg");

  const fulfillmentExpr = orderFulfillmentExpression(orders.quantityKg, deliveryAgg.total, deliveryAgg.deliveredWetKg);

  // org-scope-ok: every caller passes a where clause with the active organization predicate.
  const selectRows = () => db
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
      archivedAt: orders.archivedAt,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      version: orders.version,
      facilityName: facilities.name,
      customerName: customers.name,
      customerLocationName: customerLocations.name,
      formulationName: formulations.name,

      deliveryCount: numericAggregate(
        sql<number>`coalesce(${deliveryAgg.total}, 0)`,
      ),
      deliveredWetMassKg: numericAggregate(
        sql<number>`coalesce(${deliveryAgg.deliveredWetKg}, 0)`,
      ),
      fulfillmentStatus: fulfillmentExpr,
    })
    .from(orders)
    .leftJoin(facilities, and(eq(orders.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, ctx.organizationId)))
    .leftJoin(customerLocations, and(eq(orders.customerLocationId, customerLocations.id), eq(customerLocations.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(orders.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .leftJoin(deliveryAgg, eq(orders.id, deliveryAgg.orderId));

  return { deliveryAgg, fulfillmentExpr, selectRows };
}

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

  const { deliveryAgg, fulfillmentExpr, selectRows } = orderRowsQuery(ctx);

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
  const orderList = await selectRows()
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  return {
    items: orderList,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * One order in the list row shape, archived or not: a detail read must
 * hydrate archived references (docs/database.md), unlike the list. Backs the
 * order list's `?order=` deep link.
 */
export async function getOrderWithRelationsById(ctx: OrgContext, id: string): Promise<OrderWithRelations> {
  requireOrgScope(ctx);
  const [record] = await orderRowsQuery(ctx).selectRows()
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, id)));
  if (!record) throw new SafeError("The record could not be found.");
  return record;
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
    /** Destination (order's customer location) name and GPS. */
    destinationName: string | null;
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
      destinationName: customerLocations.name,
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

type CreateOrderData = {
  code: string; facilityId: string; customerId: string; customerLocationId: string;
  formulationId: string; orderDate: Date; quantityKg: number; packaging: "loose" | "bagged";
};
type UpdateOrderData = Partial<Omit<Order, "id" | "organizationId" | "createdAt" | "archivedAt" | "version">> & { expectedVersion: number };
const RELATIONSHIP_FIELDS: readonly OrderRelationshipField[] = ["formulationId", "facilityId", "customerId", "customerLocationId"];

async function lockOrderFormulation(ctx: OrgContext, tx: DbTransaction, formulationId: string): Promise<void> {
  requireOrgScope(ctx);
  const [formulation] = await tx.select({ id: formulations.id }).from(formulations)
    .where(and(eq(formulations.id, formulationId), eq(formulations.organizationId, ctx.organizationId))).for("share");
  if (!formulation) throw orderReferenceNotFound("formulationId");
}

async function validateOrderReferences(ctx: OrgContext, tx: DbTransaction, data: {
  customerId: string; customerLocationId: string; formulationId: string;
}): Promise<string> {
  requireOrgScope(ctx);
  const [customer] = await tx.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, data.customerId), eq(customers.organizationId, ctx.organizationId))).for("key share");
  if (!customer) throw orderReferenceNotFound("customerId");
  const [location] = await tx.select({ customerId: customerLocations.customerId }).from(customerLocations)
    .where(and(eq(customerLocations.id, data.customerLocationId), eq(customerLocations.organizationId, ctx.organizationId))).for("key share");
  if (!location) throw orderReferenceNotFound("customerLocationId");
  return location.customerId;
}

/** Orders request a formulation and wet mass; they never reserve physical stock. */
export async function createOrderInTransaction(ctx: OrgContext, tx: DbTransaction, input: CreateOrderData): Promise<Order> {
  requireOrgScope(ctx);
  await lockBiocharTransportRouteTopology(ctx, tx);
  await withFeedstockErrors(() => lockActiveFacilityReference(ctx, tx, input.facilityId), "not_found", ["facilityId"]);
  await lockOrderFormulation(ctx, tx, input.formulationId);
  const locationCustomerId = await validateOrderReferences(ctx, tx, input);
  if (locationCustomerId !== input.customerId) throw orderCustomerLocationMismatch();
  const [order] = await tx.insert(orders).values({ ...input, organizationId: ctx.organizationId }).returning();
  return order;
}

export async function updateOrderInTransaction(ctx: OrgContext, tx: DbTransaction, input: UpdateOrderData & { orderId: string }): Promise<Order> {
  requireOrgScope(ctx);
  const { orderId, expectedVersion, ...patch } = input;
  // Undefined is omitted even for in-process callers that materialize every form key.
  const data = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Omit<UpdateOrderData, "expectedVersion">;
  await lockBiocharTransportRouteTopology(ctx, tx);
  // Topology serializes order repoints. Take the facility share before the order
  // row, matching archive's facility-first cascade without moving a lock ahead of topology.
  const [snapshot] = await tx.select().from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, orderId)));
  if (!snapshot) throw orderReferenceNotFound("orderId");
  if (!snapshot.archivedAt) {
    const facilityIds = [...new Set([snapshot.facilityId, data.facilityId ?? snapshot.facilityId])].sort();
    for (const facilityId of facilityIds) {
      await withFeedstockErrors(() => lockActiveFacilityReference(ctx, tx, facilityId), "not_found", ["facilityId"]);
    }
  }
  // Stored references are protected by the foreign key. Lock only a supplied
  // formulation, before the order row, matching formulation deletion.
  if (data.formulationId !== undefined) await lockOrderFormulation(ctx, tx, data.formulationId);
  const [existing] = await tx.select().from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, orderId))).for("update");
  if (!existing) throw orderReferenceNotFound("orderId");
  assertRowVersion({ entity: "order", id: orderId, expectedVersion, actualVersion: existing.version });
  if (existing.facilityId !== snapshot.facilityId || Boolean(existing.archivedAt) !== Boolean(snapshot.archivedAt)) {
    throw staleRowVersion("order", orderId);
  }
  if (existing.archivedAt) throw orderArchived(existing.code);
  await withFeedstockErrors(() => assertCanMutateCertifiedLineage(ctx, tx, { entityType: "order", entityId: orderId }, "update"), "certification_locked", ["orderId"]);
  const merged = { ...existing, ...data };
  const locationCustomerId = await validateOrderReferences(ctx, tx, merged);
  const [delivery] = await tx.select({ code: deliveries.code }).from(deliveries)
    .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.orderId, orderId)));
  if (delivery) {
    for (const field of RELATIONSHIP_FIELDS) {
      if (data[field] !== undefined && data[field] !== existing[field]) throw orderRelationshipFrozen(field, delivery.code);
    }
  }
  if (locationCustomerId !== merged.customerId) throw orderCustomerLocationMismatch();
  if (data.quantityKg !== undefined) await assertOrderQuantityCoversAllocations(ctx, tx, { orderId, orderQuantityKg: data.quantityKg });
  return withUniqueCodeGuard(ctx, orders, orders.code, CODE_CONFLICT_MESSAGES.order, async () => {
    const [saved] = await tx.update(orders).set({ ...data, version: nextVersion(orders.version), updatedAt: new Date() })
      .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, orderId))).returning();
    return saved;
  });
}

export async function deleteOrderInTransaction(ctx: OrgContext, tx: DbTransaction, input: { orderId: string; expectedVersion: number }, source: ActivityEventInput["source"]): Promise<Order> {
  requireOrgScope(ctx);
  const { orderId, expectedVersion } = input;
  await lockBiocharTransportRouteTopology(ctx, tx);
  const [existing] = await tx.select().from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, ctx.organizationId))).for("update");
  if (!existing) throw orderReferenceNotFound("orderId");
  assertRowVersion({ entity: "order", id: orderId, expectedVersion, actualVersion: existing.version });
  await withFeedstockErrors(() => assertCanMutateCertifiedLineage(ctx, tx, { entityType: "order", entityId: orderId }, "delete"), "certification_locked", ["orderId"]);
  const [delivery] = await tx.select({ id: deliveries.id }).from(deliveries)
    .where(and(eq(deliveries.orderId, orderId), eq(deliveries.organizationId, ctx.organizationId)));
  if (delivery) throw orderHasDeliveries();
  await tx.delete(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, ctx.organizationId)));
  await retireDocumentsForEntities(ctx, tx, [{ entityType: "order", entityId: orderId }], source);
  return existing;
}

// ============================================
// Utility Operations
// ============================================

/** Load an edit record within the active organization. */
export async function getOrderById(ctx: OrgContext, id: string): Promise<Order> {
  requireOrgScope(ctx);
  const [record] = await db.select().from(orders).where(
    and(eq(orders.id, id), eq(orders.organizationId, ctx.organizationId)),
  );
  if (!record) throw new SafeError("The record could not be found.");
  return record;
}
