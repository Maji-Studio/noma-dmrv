import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
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

export async function findApiVehicle(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const [row] = await db.select().from(vehicles).where(and(
    eq(vehicles.organizationId, ctx.organizationId),
    "id" in identifier ? eq(vehicles.id, identifier.id) : eq(vehicles.code, identifier.code),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Vehicle was not found.");
  return row;
}

export async function listApiVehicles(ctx: OrgContext, filters: ApiLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  return db.select({
    ...getTableColumns(vehicles), cursorCreatedAt: lookupCursorCreatedAt(vehicles.createdAt),
  }).from(vehicles).where(and(
    eq(vehicles.organizationId, ctx.organizationId),
    filters.code === undefined ? undefined : eq(vehicles.code, filters.code),
    lookupSearch(vehicles, filters.q), lookupPosition(vehicles, cursor),
  )).orderBy(desc(vehicles.createdAt), desc(vehicles.id)).limit(limit + 1);
}
