import { and, desc, eq, getTableColumns, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { findApiOrder } from "./api-orders";
import { findApiStorageLocation } from "./api-storage-locations";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, requireApiLookupFacility, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiDeliveryFilters {
  q?: string; code?: string; facilityId?: string; orderId?: string; storageLocationId?: string; deliveredFrom?: string; deliveredBefore?: string;
}

/** Archived deliveries remain readable by id or code. */
export async function findApiDelivery(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await executor.select({ ...getTableColumns(deliveries), orderCustomerLocationId: orders.customerLocationId }).from(deliveries)
    .innerJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, ctx.organizationId))).where(and(
    eq(deliveries.organizationId, ctx.organizationId),
    "id" in identifier ? eq(deliveries.id, identifier.id) : eq(deliveries.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Delivery was not found.", {
    issues: [{ path: ["deliveryId"], code: "not_found", message: "Delivery was not found." }],
  });
  return row;
}

export async function listApiDeliveries(ctx: OrgContext, filters: ApiDeliveryFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  if (filters.orderId) await findApiOrder(ctx, { id: filters.orderId });
  if (filters.storageLocationId) await findApiStorageLocation(ctx, { id: filters.storageLocationId });
  return db.select({ ...getTableColumns(deliveries), orderCustomerLocationId: orders.customerLocationId, cursorCreatedAt: lookupCursorCreatedAt(deliveries.createdAt) }).from(deliveries)
    .innerJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, ctx.organizationId))).where(and(
    eq(deliveries.organizationId, ctx.organizationId), isNull(deliveries.archivedAt),
    filters.facilityId === undefined ? undefined : eq(deliveries.facilityId, filters.facilityId),
    filters.orderId === undefined ? undefined : eq(deliveries.orderId, filters.orderId),
    filters.storageLocationId === undefined ? undefined : eq(deliveries.storageLocationId, filters.storageLocationId),
    filters.code === undefined ? undefined : eq(deliveries.code, filters.code),
    filters.deliveredFrom === undefined ? undefined : gte(deliveries.deliveryDate, new Date(filters.deliveredFrom)),
    filters.deliveredBefore === undefined ? undefined : lt(deliveries.deliveryDate, new Date(filters.deliveredBefore)),
    lookupSearch({ name: deliveries.code }, filters.q), lookupPosition(deliveries, cursor),
  )).orderBy(desc(deliveries.createdAt), desc(deliveries.id)).limit(limit + 1);
}
