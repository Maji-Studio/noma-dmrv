import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { numericAggregate } from "@/db/aggregate";
import { applications, deliveries, facilities, orders, formulations, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { requireOrgScope } from "./utils";
import { applicationSiteDefaultsQuery } from "./application-site-defaults";
import { facilityTimestampDateExpr } from "./output-stock-dates";
import type { ApplicationDeliveryOptionData } from "./applications";

/** One application's recorded source, including facility-cascade archives. Never authorizes writes. */
export async function getLinkedApplicationDelivery(ctx: OrgContext, applicationId: string): Promise<(ApplicationDeliveryOptionData & { facilityTimezone: string | null }) | null> {
  requireOrgScope(ctx);
  const site = applicationSiteDefaultsQuery(ctx).as("application_site_defaults");

  const linkedDelivery = db.select({ deliveryId: applications.deliveryId }).from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.organizationId, ctx.organizationId)));
  const whereClause = and(
    eq(deliveries.organizationId, ctx.organizationId),
    inArray(deliveries.id, linkedDelivery),
    or(isNull(deliveries.archivedAt), and(isNotNull(facilities.archivedAt), eq(deliveries.archivedAt, facilities.archivedAt))),
  );

  const [rawDeliveries, appliedRows] = await Promise.all([
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        status: deliveries.status,
        deliveryDate: deliveries.deliveryDate,
        facilityTimezone: facilities.timezone,
        deliveryDay: facilityTimestampDateExpr(deliveries.deliveryDate, facilities.timezone),
        orderCode: orders.code,
        formulationName: formulations.name,
        productBinName: storageLocations.name,
        massDryKg: deliveries.massDryKg,
        deliveredWetMassKg: deliveries.deliveredWetMassKg,
        orderQuantityKg: orders.quantityKg,
        moistureContentPercent: deliveries.moistureContentPercent,
        defaultSoilTemperatureC: site.defaultSoilTemperatureC,
        facilityDefaultSoilTemperatureC: site.facilityDefaultSoilTemperatureC,
        destinationGpsLatitude: site.gpsLatitude,
        destinationGpsLongitude: site.gpsLongitude,
      })
      .from(deliveries)
      .leftJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
      .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
      .leftJoin(site, eq(site.deliveryId, deliveries.id))
      .leftJoin(formulations, and(eq(formulations.id, orders.formulationId), eq(formulations.organizationId, ctx.organizationId)))
      .leftJoin(
        storageLocations,
        and(
          eq(deliveries.storageLocationId, storageLocations.id),
          eq(storageLocations.organizationId, ctx.organizationId),
        ),
      )
      .where(whereClause)
      .orderBy(desc(deliveries.deliveryDate)),
    db
      .select({
        deliveryId: applications.deliveryId,
        totalAppliedKg: numericAggregate(
          sql<number>`coalesce(sum(${applications.biocharAppliedTons}) * ${KG_PER_TONNE}, 0)`,
        ),
        totalAppliedDryKg: numericAggregate(
          sql<number>`coalesce(sum(${applications.biocharAppliedDryTons}) * ${KG_PER_TONNE}, 0)`,
        ),
      })
      .from(applications)
      .innerJoin(deliveries, and(eq(applications.deliveryId, deliveries.id), eq(deliveries.organizationId, ctx.organizationId)))
      .innerJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
      .where(and(whereClause, eq(applications.organizationId, ctx.organizationId)))
      .groupBy(applications.deliveryId),
  ]);

  const appliedByDeliveryId = new Map(
    appliedRows.map((row) => [row.deliveryId, row])
  );

  const results = rawDeliveries.map((delivery) => {
    const applied = appliedByDeliveryId.get(delivery.id);
    return {
      ...delivery,
      alreadyAppliedWetKg: applied?.totalAppliedKg ?? 0,
      alreadyAppliedDryKg: applied?.totalAppliedDryKg ?? 0,
    };
  });
  return results[0] ?? null;
}
