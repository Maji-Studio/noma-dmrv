import { withLocationFacilityDistances } from "./location-facility-distances";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, customerLocations, type Customer } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { FacilityDistance } from "@/schemas/facility-distances";
import { requireOrgScope } from "./utils";

export interface CustomerDetail extends Customer {
  locations: Array<{
    id: string;
    name: string;
    country: string;
    stateRegion: string | null;
    city: string | null;
    gpsLatitude: number;
    gpsLongitude: number;
    address: string | null;
    facilityDistances: FacilityDistance[];
    defaultSoilTemperatureC: number | null;
    isDefault: boolean;
    createdAt: Date;
    version: number;
    updatedAt: Date;
    archivedAt: Date | null;
  }>;
}

/**
 * Resolve the complete payload used by the full customer detail route.
 * Returns `null` for an absent or inaccessible customer so the route can
 * render its not-found boundary without a separate option-shaped preflight.
 */
export async function findCustomerWithRelations(
  ctx: OrgContext,
  customerId: string,
): Promise<CustomerDetail | null> {
  requireOrgScope(ctx);

  const [customer] = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.organizationId, ctx.organizationId),
      ),
    );

  if (!customer) {
    return null;
  }

  const locations = await db
    .select({
      id: customerLocations.id,
      name: customerLocations.name,
      country: customerLocations.country,
      stateRegion: customerLocations.stateRegion,
      city: customerLocations.city,
      gpsLatitude: customerLocations.gpsLatitude,
      gpsLongitude: customerLocations.gpsLongitude,
      address: customerLocations.address,
      defaultSoilTemperatureC: customerLocations.defaultSoilTemperatureC,
      isDefault: customerLocations.isDefault,
      createdAt: customerLocations.createdAt,
      version: customerLocations.version,
      updatedAt: customerLocations.updatedAt,
      archivedAt: customerLocations.archivedAt,
    })
    .from(customerLocations)
    .where(
      and(
        eq(customerLocations.customerId, customerId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(sql`${customerLocations.name} asc nulls last`);

  return { ...customer, locations: await withLocationFacilityDistances(ctx, "customer", locations) };
}
