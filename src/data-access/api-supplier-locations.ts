import { apiLocationFacilityDistances } from "./api-location-facility-distances";
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { supplierLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope, type Executor } from "./utils";
import { findApiSupplier } from "./api-suppliers";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  type ApiLookupPosition,
} from "./api-lookup-filters";

function supplierLocationFields(ctx: OrgContext) {
  requireOrgScope(ctx);
  return {
    ...getTableColumns(supplierLocations), cursorCreatedAt: lookupCursorCreatedAt(supplierLocations.createdAt),
    facilityDistances: apiLocationFacilityDistances(ctx, "supplier"),
  };
}

export async function findApiSupplierLocation(
  ctx: OrgContext, supplierId: string, locationId: string, executor: Executor = db,
) {
  requireOrgScope(ctx);
  const [row] = await executor.select(supplierLocationFields(ctx)).from(supplierLocations).where(and(
    eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.supplierId, supplierId),
    eq(supplierLocations.id, locationId),
  )).limit(1);
  return row ?? null;
}

export async function listApiSupplierLocations(
  ctx: OrgContext, filters: { supplierId: string; q?: string }, limit: number, cursor?: ApiLookupPosition, executor: Executor = db,
) {
  requireOrgScope(ctx);
  await findApiSupplier(ctx, { id: filters.supplierId }, executor);
  return executor.select(supplierLocationFields(ctx)).from(supplierLocations).where(and(
    eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.supplierId, filters.supplierId),
    lookupSearch({ name: supplierLocations.name }, filters.q), lookupPosition(supplierLocations, cursor),
  )).orderBy(desc(supplierLocations.createdAt), desc(supplierLocations.id)).limit(limit + 1);
}
