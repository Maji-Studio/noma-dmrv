import { db } from "@/db";
import { customerLocations, deliveries, facilities, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { deriveTransportLeg, resolveDeliveryTransportRoute } from "@/lib/calculations/transport-leg";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray } from "drizzle-orm";
import type { TransportLegWithEvidence } from "./transport-legs";
import { transportEvidenceDocumentCount } from "./transport-evidence-projections";
import { requireOrgScope } from "./utils";

/**
 * Project frozen application loads onto recorded delivery distances. These rows are
 * read-model legs, identified by delivery, not persisted product transport legs.
 */
export async function loadBiocharDeliveryTransportLegs(
  ctx: OrgContext,
  slices: readonly { deliveryId: string; loadMassKg: number }[],
): Promise<TransportLegWithEvidence[]> {
  requireOrgScope(ctx);
  const massByDelivery = new Map<string, number>();
  for (const slice of slices) {
    massByDelivery.set(slice.deliveryId, (massByDelivery.get(slice.deliveryId) ?? 0) + slice.loadMassKg);
  }
  const ids = [...massByDelivery.keys()].sort();
  if (!ids.length) return [];
  const rows = await db.select({ delivery: deliveries, facility: {
      name: facilities.name,
      gpsLatitude: facilities.gpsLatitude,
      gpsLongitude: facilities.gpsLongitude,
    }, orderLocationId: orders.customerLocationId,
    transportEvidenceDocumentCount: transportEvidenceDocumentCount(ctx.organizationId, "delivery", "deliveryId"),
  })
    .from(deliveries)
    .innerJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, ctx.organizationId)))
    .where(and(inArray(deliveries.id, ids), eq(deliveries.organizationId, ctx.organizationId)));
  if (rows.length !== ids.length) throw new SafeError("A Removal delivery could not be loaded.");
  const locationIds = rows.flatMap(({ orderLocationId }) => orderLocationId ? [orderLocationId] : []);
  const locations = locationIds.length ? await db.select().from(customerLocations).where(and(
    inArray(customerLocations.id, locationIds), eq(customerLocations.organizationId, ctx.organizationId),
  )) : [];
  const locationsById = new Map(locations.map(location => [location.id, location]));
  return rows.sort((a, b) => a.delivery.id.localeCompare(b.delivery.id)).map(({ delivery, facility, orderLocationId, transportEvidenceDocumentCount }) => {
    const location = locationsById.get(orderLocationId ?? "");
    const route = resolveDeliveryTransportRoute({ ...delivery, location: location ? { ...location, distanceKm: delivery.recordedDistanceKm, distanceSource: delivery.recordedDistanceSource } : null });
    const derived = deriveTransportLeg({
      origin: facility, destination: {
        name: route.locationName,
        gpsLatitude: route.locationGpsLatitude,
        gpsLongitude: route.locationGpsLongitude,
      }, vehicle: null,
      loadMassKg: massByDelivery.get(delivery.id),
      storedDistanceKm: route.distanceKm,
      storedDistanceSource: route.distanceSource,
    });
    return {
      originGpsLatitude: derived.originGpsLatitude,
      originGpsLongitude: derived.originGpsLongitude,
      destinationGpsLatitude: derived.destinationGpsLatitude,
      destinationGpsLongitude: derived.destinationGpsLongitude,
      distanceSource: derived.distanceSource,
      transportMethodType: derived.transportMethodType,
      calculationMethodType: derived.calculationMethodType,
      vehicleType: derived.vehicleType,
      modelYear: derived.modelYear,
      loadMassKg: derived.loadMassKg,
      // Keep incomplete routes visible to readiness and aggregation; never drop a delivery.
      distanceKm: derived.distanceKm ?? 0,
      id: delivery.id, entityId: delivery.id, entityType: "biochar" as const,
      organizationId: ctx.organizationId, version: delivery.version, isDerived: true,
      originName: facility.name,
      destinationName: `${delivery.code}: ${route.locationName ?? "Customer location not set"}`,
      createdAt: delivery.createdAt, updatedAt: delivery.updatedAt,
      transportEvidenceDocumentCount,
    };
  });
}
