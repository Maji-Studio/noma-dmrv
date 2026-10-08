import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes } from "@/db/schema";
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

export async function findApiFeedstockType(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const [row] = await db.select().from(feedstockTypes).where(and(
    eq(feedstockTypes.organizationId, ctx.organizationId),
    "id" in identifier ? eq(feedstockTypes.id, identifier.id) : eq(feedstockTypes.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Feedstock type was not found.");
  return row;
}

export async function listApiFeedstockTypes(ctx: OrgContext, filters: ApiLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  return db.select({
    ...getTableColumns(feedstockTypes), cursorCreatedAt: lookupCursorCreatedAt(feedstockTypes.createdAt),
  }).from(feedstockTypes).where(and(
    eq(feedstockTypes.organizationId, ctx.organizationId),
    isNull(feedstockTypes.archivedAt),
    filters.code === undefined ? undefined : eq(feedstockTypes.code, filters.code),
    lookupSearch(feedstockTypes, filters.q), lookupPosition(feedstockTypes, cursor),
  )).orderBy(desc(feedstockTypes.createdAt), desc(feedstockTypes.id)).limit(limit + 1);
}
