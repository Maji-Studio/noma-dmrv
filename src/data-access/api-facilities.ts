import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
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

export async function findApiFacility(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const [row] = await db.select().from(facilities).where(and(
    eq(facilities.organizationId, ctx.organizationId),
    "id" in identifier ? eq(facilities.id, identifier.id) : eq(facilities.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Facility was not found.");
  return row;
}

export async function listApiFacilities(ctx: OrgContext, filters: ApiLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  return db.select({
    ...getTableColumns(facilities), cursorCreatedAt: lookupCursorCreatedAt(facilities.createdAt),
  }).from(facilities).where(and(
    eq(facilities.organizationId, ctx.organizationId),
    isNull(facilities.archivedAt),
    filters.code === undefined ? undefined : eq(facilities.code, filters.code),
    lookupSearch(facilities, filters.q), lookupPosition(facilities, cursor),
  )).orderBy(desc(facilities.createdAt), desc(facilities.id)).limit(limit + 1);
}
