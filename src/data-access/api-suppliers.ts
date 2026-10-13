import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope } from "./utils";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  type ApiLookupFilters,
  type ApiLookupIdentifier,
  type ApiLookupPosition,
} from "./api-lookup-filters";

export async function findApiSupplier(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const [row] = await db.select().from(suppliers).where(and(
    eq(suppliers.organizationId, ctx.organizationId),
    "id" in identifier ? eq(suppliers.id, identifier.id) : eq(suppliers.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Supplier was not found.");
  return row;
}

export async function listApiSuppliers(ctx: OrgContext, filters: ApiLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  return db.select({
    ...getTableColumns(suppliers), cursorCreatedAt: lookupCursorCreatedAt(suppliers.createdAt),
  }).from(suppliers).where(and(
    eq(suppliers.organizationId, ctx.organizationId),
    filters.code === undefined ? undefined : eq(suppliers.code, filters.code),
    lookupSearch(suppliers, filters.q), lookupPosition(suppliers, cursor),
  )).orderBy(desc(suppliers.createdAt), desc(suppliers.id)).limit(limit + 1);
}
