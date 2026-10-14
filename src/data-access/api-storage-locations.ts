import type { StorageLocationType } from "@/schemas/storage-locations";
import { findApiFormulation } from "./api-formulations";
import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  requireApiLookupFacility,
  type ApiFacilityLookupFilters,
  type ApiLookupIdentifier,
  type ApiLookupPosition,
} from "./api-lookup-filters";

/**
 * A snapshot read passes its transaction as `executor`; both queries then read
 * through it. The bin query runs first, so it is the statement that fixes a
 * snapshot; a foreign facility still answers before an unknown bin.
 */
export async function findApiStorageLocation(ctx: OrgContext, identifier: ApiLookupIdentifier, facilityId?: string, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await executor.select().from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId),
    "id" in identifier ? eq(storageLocations.id, identifier.id) : eq(storageLocations.code, identifier.code),
    facilityId === undefined ? undefined : eq(storageLocations.facilityId, facilityId),
  )).limit(1);
  await requireApiLookupFacility(ctx, facilityId, executor);
  if (!row) throw new DomainError("not_found", "Storage location was not found.");
  return row;
}

export interface ApiStorageLocationFilters extends ApiFacilityLookupFilters { type?: StorageLocationType; formulationId?: string }

export async function listApiStorageLocations(ctx: OrgContext, filters: ApiStorageLocationFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  if (filters.formulationId) await findApiFormulation(ctx, { id: filters.formulationId });
  return db.select({
    ...getTableColumns(storageLocations), cursorCreatedAt: lookupCursorCreatedAt(storageLocations.createdAt),
  }).from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId),
    isNull(storageLocations.archivedAt),
    filters.type === undefined ? undefined : eq(storageLocations.type, filters.type),
    filters.formulationId === undefined ? undefined : eq(storageLocations.formulationId, filters.formulationId),
    filters.facilityId === undefined ? undefined : eq(storageLocations.facilityId, filters.facilityId),
    filters.code === undefined ? undefined : eq(storageLocations.code, filters.code),
    lookupSearch(storageLocations, filters.q), lookupPosition(storageLocations, cursor),
  )).orderBy(desc(storageLocations.createdAt), desc(storageLocations.id)).limit(limit + 1);
}
