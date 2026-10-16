import { withLocationFacilityDistances } from "./location-facility-distances";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { findApiCustomer } from "./api-customers";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  type ApiLookupPosition,
} from "./api-lookup-filters";

export async function listApiCustomerLocations(
  ctx: OrgContext, filters: { customerId: string; q?: string }, limit: number, cursor?: ApiLookupPosition,
) {
  requireOrgScope(ctx);
  await findApiCustomer(ctx, { id: filters.customerId });
  const locations = await db.select({
    id: customerLocations.id, customerId: customerLocations.customerId, name: customerLocations.name,
    gpsLatitude: customerLocations.gpsLatitude, gpsLongitude: customerLocations.gpsLongitude,
    isDefault: customerLocations.isDefault, version: customerLocations.version,
    createdAt: customerLocations.createdAt, updatedAt: customerLocations.updatedAt,
    cursorCreatedAt: lookupCursorCreatedAt(customerLocations.createdAt),
  }).from(customerLocations).where(and(
    eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, filters.customerId),
    lookupSearch({ name: customerLocations.name }, filters.q), lookupPosition(customerLocations, cursor),
  )).orderBy(desc(customerLocations.createdAt), desc(customerLocations.id)).limit(limit + 1);
  return withLocationFacilityDistances(ctx, "customer", locations);
}
