import { db } from "@/db";
import { customerLocations, deliveries, documents, facilities, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { deriveTransportLeg } from "@/lib/calculations/transport-leg";
import { TRANSPORT_EVIDENCE_DOCUMENT_TYPES } from "@/lib/certification/transport-evidence";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray } from "drizzle-orm";
import type { TransportLegWithEvidence } from "./transport-legs";
import { requireOrgScope } from "./utils";

/**
 * Project frozen application loads onto live delivery routes. These rows are
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
    }, orderLocationId: orders.customerLocationId })
    .from(deliveries)
    .innerJoin(facilities, and(eq(facilities.id, deliveries.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, ctx.organizationId)))
    .where(and(inArray(deliveries.id, ids), eq(deliveries.organizationId, ctx.organizationId)));
  if (rows.length !== ids.length) throw new SafeError("A Removal delivery could not be loaded.");
  const locationIds = rows.flatMap(({ delivery, orderLocationId }) => {
    const id = delivery.customerLocationId ?? orderLocationId;
    return id ? [id] : [];
  });
  const [locations, evidence] = await Promise.all([
    locationIds.length ? db.select().from(customerLocations).where(and(
      inArray(customerLocations.id, locationIds), eq(customerLocations.organizationId, ctx.organizationId),
    )) : [],
    db.select({ entityId: documents.entityId }).from(documents).where(and(
      eq(documents.organizationId, ctx.organizationId), eq(documents.entityType, "delivery"),
      inArray(documents.entityId, ids), eq(documents.uploadStatus, "uploaded"),
      inArray(documents.documentType, [...TRANSPORT_EVIDENCE_DOCUMENT_TYPES]),
    )),
  ]);
  const locationsById = new Map(locations.map(location => [location.id, location]));
  const evidenceCounts = new Map<string, number>();
  for (const document of evidence) {
    evidenceCounts.set(document.entityId, (evidenceCounts.get(document.entityId) ?? 0) + 1);
  }
  return rows.sort((a, b) => a.delivery.id.localeCompare(b.delivery.id)).map(({ delivery, facility, orderLocationId }) => {
    const location = locationsById.get(delivery.customerLocationId ?? orderLocationId ?? "");
    const derived = deriveTransportLeg({
      origin: facility, destination: location ?? null, vehicle: null,
      loadMassKg: massByDelivery.get(delivery.id),
      distanceKmOverride: delivery.distanceKmOverride,
      distanceSourceOverride: delivery.distanceSource,
      storedDistanceKm: location?.distanceFromFacilityKm,
      storedDistanceSource: location?.distanceSource,
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
      destinationName: `${delivery.code}: ${location?.name ?? "Customer location not set"}`,
      billOfLading: null, weighScaleTicketRef: null,
      createdAt: delivery.createdAt, updatedAt: delivery.updatedAt,
      transportEvidenceDocumentCount: evidenceCounts.get(delivery.id) ?? 0,
    };
  });
}
