import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { deliveries, orders, customerLocations, certifierProjects, facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/** The order owns the site now that deliveries.customer_location_id is gone. */
export async function getApplicationSiteDefaults(ctx: OrgContext, tx: DbTransaction, deliveryId: string) {
  requireOrgScope(ctx);
  const sites = await tx.select({
    customerLocationId: customerLocations.id,
    customerLocationName: customerLocations.name,
    gpsLatitude: customerLocations.gpsLatitude,
    gpsLongitude: customerLocations.gpsLongitude,
    defaultSoilTemperatureC: customerLocations.defaultSoilTemperatureC,
    facilityDefaultSoilTemperatureC: certifierProjects.defaultSoilTemperatureC,
    durabilityOption: facilities.durabilityOption,
  }).from(deliveries)
    .innerJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, ctx.organizationId)))
    .innerJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(customerLocations, and(eq(customerLocations.id, orders.customerLocationId), eq(customerLocations.organizationId, ctx.organizationId)))
    .leftJoin(certifierProjects, and(eq(certifierProjects.facilityId, deliveries.facilityId), eq(certifierProjects.provider, "isometric"), eq(certifierProjects.organizationId, ctx.organizationId)))
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)));
  return sites.at(0) ?? null;
}
