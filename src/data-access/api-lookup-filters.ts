import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope } from "./utils";

export interface ApiLookupFilters { q?: string; code?: string }
export interface ApiFacilityLookupFilters extends ApiLookupFilters { facilityId?: string }
export type ApiLookupIdentifier = { id: string } | { code: string };
export interface ApiLookupPosition { createdAt: string; id: string }

export async function requireApiLookupFacility(ctx: OrgContext, facilityId?: string) {
  requireOrgScope(ctx);
  if (facilityId === undefined) return;
  const [facility] = await db.select({ id: facilities.id }).from(facilities).where(and(
    eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId),
  )).limit(1);
  if (!facility) throw new DomainError("not_found", "Facility was not found.", {
    issues: [{ path: ["facilityId"], code: "not_found", message: "Facility was not found." }],
  });
}

export function lookupSearch(columns: { code?: AnyPgColumn; name: AnyPgColumn }, q?: string) {
  if (q === undefined) return undefined;
  const prefix = `${q.replace(/[\\%_]/g, "\\$&")}%`;
  return or(columns.code ? ilike(columns.code, prefix) : undefined, ilike(columns.name, prefix));
}

export function lookupPosition(columns: { createdAt: AnyPgColumn; id: AnyPgColumn }, cursor?: ApiLookupPosition) {
  return cursor ? sql`(${columns.createdAt}, ${columns.id}) < (${cursor.createdAt}::timestamp, ${cursor.id}::uuid)` : undefined;
}

/** Preserve PostgreSQL microseconds, as the feedstock collection does. */
export function lookupCursorCreatedAt(createdAt: AnyPgColumn) {
  return sql<string>`to_char(${createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
