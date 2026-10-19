import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { drivers } from "@/db/schema";
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

export async function findApiDriver(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const [row] = await db.select().from(drivers).where(and(
    eq(drivers.organizationId, ctx.organizationId),
    "id" in identifier ? eq(drivers.id, identifier.id) : eq(drivers.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Driver was not found.");
  return row;
}

export async function listApiDrivers(ctx: OrgContext, filters: ApiLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  return db.select({
    ...getTableColumns(drivers), cursorCreatedAt: lookupCursorCreatedAt(drivers.createdAt),
  }).from(drivers).where(and(
    eq(drivers.organizationId, ctx.organizationId),
    filters.code === undefined ? undefined : eq(drivers.code, filters.code),
    lookupSearch(drivers, filters.q), lookupPosition(drivers, cursor),
  )).orderBy(desc(drivers.createdAt), desc(drivers.id)).limit(limit + 1);
}
