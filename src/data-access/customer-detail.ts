import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, customerLocations, type Customer } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { requireOrgScope } from "./utils";

export interface CustomerDetail extends Customer {
  locations: Array<{
    id: string;
    name: string | null;
    country: string;
    stateRegion: string | null;
    city: string | null;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    address: string | null;
    distanceFromFacilityKm: number | null;
    distanceSource: DistanceSourceValue | null;
    defaultSoilTemperatureC: number | null;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
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
      distanceFromFacilityKm: customerLocations.distanceFromFacilityKm,
      distanceSource: customerLocations.distanceSource,
      defaultSoilTemperatureC: customerLocations.defaultSoilTemperatureC,
      isDefault: customerLocations.isDefault,
      createdAt: customerLocations.createdAt,
      updatedAt: customerLocations.updatedAt,
    })
    .from(customerLocations)
    .where(
      and(
        eq(customerLocations.customerId, customerId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(sql`${customerLocations.name} asc nulls last`);

  return { ...customer, locations };
}
