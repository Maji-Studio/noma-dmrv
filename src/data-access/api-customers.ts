import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  type ApiLookupFilters,
  type ApiLookupIdentifier,
  type ApiLookupPosition,
} from "./api-lookup-filters";

/** Only lookup fields are selected; contact details never enter the API read model. */
function customerFields(ctx: OrgContext) {
  requireOrgScope(ctx);
  return { id: customers.id, code: customers.code, name: customers.name, version: customers.version,
    cropType: customers.cropType, archivedAt: customers.archivedAt,
    createdAt: customers.createdAt, updatedAt: customers.updatedAt };
}

export async function findApiCustomer(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await executor.select(customerFields(ctx)).from(customers).where(and(
    eq(customers.organizationId, ctx.organizationId),
    "id" in identifier ? eq(customers.id, identifier.id) : eq(customers.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Customer was not found.", { issues: [{ path: ["customerId"], code: "not_found", message: "Customer was not found." }] });
  return row;
}

export async function listApiCustomers(ctx: OrgContext, filters: ApiLookupFilters & { archived?: boolean }, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  return db.select({
    ...customerFields(ctx), cursorCreatedAt: lookupCursorCreatedAt(customers.createdAt),
  }).from(customers).where(and(
    eq(customers.organizationId, ctx.organizationId),
    filters.archived ? isNotNull(customers.archivedAt) : isNull(customers.archivedAt),
    filters.code === undefined ? undefined : eq(customers.code, filters.code),
    lookupSearch(customers, filters.q), lookupPosition(customers, cursor),
  )).orderBy(desc(customers.createdAt), desc(customers.id)).limit(limit + 1);
}
