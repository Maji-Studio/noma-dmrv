import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db } from "@/db";
import { feedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { requireApiLookupFacility, lookupCursorCreatedAt, lookupPosition, lookupSearch, type ApiFacilityLookupFilters } from "./api-lookup-filters";

export type ApiFeedstockFilters = ApiFacilityLookupFilters;

export async function findApiFeedstock(ctx: OrgContext, identifier: { id: string } | { code: string }, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await executor.select().from(feedstocks).where(and(
    eq(feedstocks.organizationId, ctx.organizationId),
    "id" in identifier ? eq(feedstocks.id, identifier.id) : eq(feedstocks.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Feedstock was not found.");
  return row;
}

export async function listApiFeedstocks(
  ctx: OrgContext, filters: ApiFeedstockFilters, limit: number, cursor?: { createdAt: string; id: string },
) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  return db.select({
    ...getTableColumns(feedstocks),
    cursorCreatedAt: lookupCursorCreatedAt(feedstocks.createdAt),
  }).from(feedstocks).where(and(
    eq(feedstocks.organizationId, ctx.organizationId), isNull(feedstocks.archivedAt),
    filters.facilityId ? eq(feedstocks.facilityId, filters.facilityId) : undefined,
    filters.code !== undefined ? eq(feedstocks.code, filters.code) : undefined,
    lookupSearch({ name: feedstocks.code }, filters.q),
    lookupPosition(feedstocks, cursor),
  )).orderBy(desc(feedstocks.createdAt), desc(feedstocks.id)).limit(limit + 1);
}
