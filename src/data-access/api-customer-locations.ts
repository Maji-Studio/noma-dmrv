import { apiLocationFacilityDistances } from "./api-location-facility-distances";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope, type Executor } from "./utils";
import { findApiCustomer } from "./api-customers";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  type ApiLookupPosition,
} from "./api-lookup-filters";

function customerLocationFields(ctx: OrgContext) {
  requireOrgScope(ctx);
  return {
    id: customerLocations.id, customerId: customerLocations.customerId, name: customerLocations.name,
    gpsLatitude: customerLocations.gpsLatitude, gpsLongitude: customerLocations.gpsLongitude,
    country: customerLocations.country, stateRegion: customerLocations.stateRegion, city: customerLocations.city,
    siteDescription: customerLocations.address, defaultSoilTemperatureC: customerLocations.defaultSoilTemperatureC,
    isDefault: customerLocations.isDefault, version: customerLocations.version, archivedAt: customerLocations.archivedAt,
    facilityDistances: apiLocationFacilityDistances(ctx, "customer"),
    createdAt: customerLocations.createdAt, updatedAt: customerLocations.updatedAt,
    cursorCreatedAt: lookupCursorCreatedAt(customerLocations.createdAt),
  };
}

export async function findApiCustomerLocation(
  ctx: OrgContext, customerId: string, locationId: string, executor: Executor = db,
) {
  requireOrgScope(ctx);
  const [row] = await executor.select(customerLocationFields(ctx)).from(customerLocations).where(and(
    eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, customerId),
    eq(customerLocations.id, locationId),
  )).limit(1);
  return row ?? null;
}

export async function listApiCustomerLocations(
  ctx: OrgContext, filters: { customerId: string; q?: string }, limit: number, cursor?: ApiLookupPosition, executor: Executor = db,
) {
  requireOrgScope(ctx);
  await findApiCustomer(ctx, { id: filters.customerId }, executor);
  return executor.select(customerLocationFields(ctx)).from(customerLocations).where(and(
    eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, filters.customerId),
    lookupSearch({ name: customerLocations.name }, filters.q), lookupPosition(customerLocations, cursor),
  )).orderBy(desc(customerLocations.createdAt), desc(customerLocations.id)).limit(limit + 1);
}
