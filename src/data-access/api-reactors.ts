import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db } from "@/db";
import { reactors } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope } from "./utils";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  requireApiLookupFacility,
  type ApiFacilityLookupFilters,
  type ApiLookupIdentifier,
  type ApiLookupPosition,
} from "./api-lookup-filters";

export async function findApiReactor(ctx: OrgContext, identifier: ApiLookupIdentifier, facilityId?: string) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, facilityId);
  const [row] = await db.select().from(reactors).where(and(
    eq(reactors.organizationId, ctx.organizationId),
    "id" in identifier ? eq(reactors.id, identifier.id) : eq(reactors.code, identifier.code),
    facilityId === undefined ? undefined : eq(reactors.facilityId, facilityId),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Reactor was not found.", {
    issues: [{ path: ["reactorId"], code: "not_found", message: "Reactor was not found." }],
  });
  return row;
}

export async function listApiReactors(ctx: OrgContext, filters: ApiFacilityLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  return db.select({
    ...getTableColumns(reactors), cursorCreatedAt: lookupCursorCreatedAt(reactors.createdAt),
  }).from(reactors).where(and(
    eq(reactors.organizationId, ctx.organizationId),
    isNull(reactors.archivedAt),
    filters.facilityId === undefined ? undefined : eq(reactors.facilityId, filters.facilityId),
    filters.code === undefined ? undefined : eq(reactors.code, filters.code),
    lookupSearch({ code: reactors.code, name: reactors.identifier }, filters.q), lookupPosition(reactors, cursor),
  )).orderBy(desc(reactors.createdAt), desc(reactors.id)).limit(limit + 1);
}
