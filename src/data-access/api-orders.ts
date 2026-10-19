import { and, desc, eq, getTableColumns, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { findApiCustomer } from "./api-customers";
import { findApiFormulation } from "./api-formulations";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, requireApiLookupFacility, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiOrderFilters {
  q?: string; code?: string; facilityId?: string; customerId?: string; formulationId?: string; orderedFrom?: string; orderedBefore?: string;
}

/** Archived orders remain readable by id or code. */
export async function findApiOrder(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await executor.select().from(orders).where(and(
    eq(orders.organizationId, ctx.organizationId),
    "id" in identifier ? eq(orders.id, identifier.id) : eq(orders.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Order was not found.", {
    issues: [{ path: ["orderId"], code: "not_found", message: "Order was not found." }],
  });
  return row;
}

export async function listApiOrders(ctx: OrgContext, filters: ApiOrderFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  if (filters.customerId) await findApiCustomer(ctx, { id: filters.customerId });
  if (filters.formulationId) await findApiFormulation(ctx, { id: filters.formulationId });
  return db.select({ ...getTableColumns(orders), cursorCreatedAt: lookupCursorCreatedAt(orders.createdAt) }).from(orders).where(and(
    eq(orders.organizationId, ctx.organizationId), isNull(orders.archivedAt),
    filters.facilityId === undefined ? undefined : eq(orders.facilityId, filters.facilityId),
    filters.customerId === undefined ? undefined : eq(orders.customerId, filters.customerId),
    filters.formulationId === undefined ? undefined : eq(orders.formulationId, filters.formulationId),
    filters.code === undefined ? undefined : eq(orders.code, filters.code),
    filters.orderedFrom === undefined ? undefined : gte(orders.orderDate, new Date(`${filters.orderedFrom}T00:00:00.000Z`)),
    filters.orderedBefore === undefined ? undefined : lt(orders.orderDate, new Date(`${filters.orderedBefore}T00:00:00.000Z`)),
    lookupSearch({ name: orders.code }, filters.q), lookupPosition(orders, cursor),
  )).orderBy(desc(orders.createdAt), desc(orders.id)).limit(limit + 1);
}
