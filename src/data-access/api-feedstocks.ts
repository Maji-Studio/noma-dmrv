import { and, desc, eq, getTableColumns, ilike, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities, feedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";

export interface ApiFeedstockFilters { facilityId?: string; q?: string; code?: string }

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
  if (filters.facilityId) {
    const [facility] = await db.select({ id: facilities.id }).from(facilities).where(and(
      eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, filters.facilityId),
    )).limit(1);
    if (!facility) throw new DomainError("not_found", "Facility was not found.", {
      issues: [{ path: ["facilityId"], code: "not_found", message: "Facility was not found." }],
    });
  }
  return db.select({
    ...getTableColumns(feedstocks),
    cursorCreatedAt: sql<string>`to_char(${feedstocks.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(feedstocks).where(and(
    eq(feedstocks.organizationId, ctx.organizationId), isNull(feedstocks.archivedAt),
    filters.facilityId ? eq(feedstocks.facilityId, filters.facilityId) : undefined,
    filters.code !== undefined ? eq(feedstocks.code, filters.code) : undefined,
    filters.q !== undefined ? ilike(feedstocks.code, `${filters.q.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
    cursor ? sql`(${feedstocks.createdAt}, ${feedstocks.id}) < (${cursor.createdAt}::timestamp, ${cursor.id}::uuid)` : undefined,
  )).orderBy(desc(feedstocks.createdAt), desc(feedstocks.id)).limit(limit + 1);
}
