import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { ApiLookupIdentifier } from "./api-lookup-filters";
import { findApiDelivery } from "./api-deliveries";
import { deliveryApplicationBalanceFields } from "./delivery-application-balance";
import { getApplicationSiteDefaults } from "./application-site-defaults";
import { facilityTimestampDateExpr } from "./output-stock-dates";
import { requireOrgScope } from "./utils";

/** Archived deliveries remain readable; every published fact uses the same snapshot. */
export async function findApiDeliveryApplicationBalance(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  return db.transaction(async tx => {
    const delivery = await findApiDelivery(ctx, identifier, tx);
    const [balance] = await tx.select({ ...deliveryApplicationBalanceFields(ctx),
      earliestApplicationDate: facilityTimestampDateExpr(deliveries.deliveryDate, facilities.timezone),
    }).from(deliveries).innerJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
      .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, delivery.id)));
    const site = await getApplicationSiteDefaults(ctx, tx, delivery.id);
    const usesTemperature = site?.durabilityOption !== "1000_year";
    const temperature = usesTemperature ? site?.defaultSoilTemperatureC ?? site?.facilityDefaultSoilTemperatureC ?? null : null;
    return { deliveryId: delivery.id, deliveredWetMassKg: delivery.deliveredWetMassKg, dryBiocharKg: delivery.massDryKg,
      ...balance, site: { customerLocationId: site?.customerLocationId ?? null, gpsLatitude: site?.gpsLatitude ?? null,
        gpsLongitude: site?.gpsLongitude ?? null, defaultSoilTemperatureC: temperature,
        soilTemperatureDefault: temperature === null ? null : site?.defaultSoilTemperatureC != null ? "customer_location" as const : "facility" as const },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
