import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
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

export async function findApiStorageLocation(ctx: OrgContext, identifier: ApiLookupIdentifier, facilityId?: string) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, facilityId);
  const [row] = await db.select().from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId),
    "id" in identifier ? eq(storageLocations.id, identifier.id) : eq(storageLocations.code, identifier.code),
    facilityId === undefined ? undefined : eq(storageLocations.facilityId, facilityId),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Storage location was not found.");
  return row;
}

export async function listApiStorageLocations(ctx: OrgContext, filters: ApiFacilityLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  return db.select({
    ...getTableColumns(storageLocations), cursorCreatedAt: lookupCursorCreatedAt(storageLocations.createdAt),
  }).from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId),
    isNull(storageLocations.archivedAt),
    filters.facilityId === undefined ? undefined : eq(storageLocations.facilityId, filters.facilityId),
    filters.code === undefined ? undefined : eq(storageLocations.code, filters.code),
    lookupSearch(storageLocations, filters.q), lookupPosition(storageLocations, cursor),
  )).orderBy(desc(storageLocations.createdAt), desc(storageLocations.id)).limit(limit + 1);
}
