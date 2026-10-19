import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { customerLocationFacilityDistances, deliveries, feedstocks, orders, supplierLocationFacilityDistances, supplierLocations, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { TransportDistanceTarget } from "@/schemas/transport-distance-refresh";
import { getCertifiedLineage, isSubmittedLineageRow } from "./certification-lineage-guards";
import { deliveryProductAllocations } from "./delivery-allocation-provenance";
import { requireOrgScope } from "./utils";

/** Include shared products because refreshing a delivery also rewrites their aggregate legs. */
export async function distanceRefreshLineageTargets(ctx: OrgContext, tx: DbTransaction, target: TransportDistanceTarget) {
  requireOrgScope(ctx);
  if (target.entityType === "feedstock") return [target];
  const allocated = deliveryProductAllocations(ctx, tx);
  const products = await tx.select({ id: allocated.biocharProductId }).from(allocated)
    // org-scope-ok: deliveryProductAllocations scopes all sources to ctx.organizationId.
    .where(eq(allocated.deliveryId, target.entityId));
  return [target, ...products.flatMap(row => row.id ? [{ entityType: "biocharProduct" as const, entityId: row.id }] : [])];
}

export interface TransportDistanceDrift extends TransportDistanceTarget {
  expectedVersion: number;
  distanceKmOverride: number | null;
  recordedDistanceKm: number | null;
  recordedDistanceSource: DistanceSourceValue | null;
  currentDistanceKm: number | null;
  currentDistanceSource: DistanceSourceValue | null;
  locationId: string | null;
  facilityId: string;
  isOverridden: boolean;
  hasDrift: boolean;
  hasSubmittedRemoval: boolean;
}

/** Single-record advisory read. Refresh rechecks lineage and versions under locks. */
export async function getTransportDistanceDrift(
  ctx: OrgContext, target: TransportDistanceTarget, tx?: DbTransaction,
): Promise<TransportDistanceDrift> {
  requireOrgScope(ctx);
  if (!tx) return db.transaction(transaction => getTransportDistanceDrift(ctx, target, transaction), {
    isolationLevel: "repeatable read", accessMode: "read only",
  });
  const [row] = target.entityType === "feedstock"
    ? await tx.select({
      expectedVersion: feedstocks.version,
      distanceKmOverride: feedstocks.distanceKmOverride,
      recordedDistanceKm: transportLegs.distanceKm,
      recordedDistanceSource: transportLegs.distanceSource,
      currentDistanceKm: supplierLocationFacilityDistances.distanceKm,
      currentDistanceSource: supplierLocationFacilityDistances.distanceSource,
      locationId: supplierLocations.id,
      facilityId: feedstocks.facilityId,
    }).from(feedstocks)
      .leftJoin(supplierLocations, and(eq(supplierLocations.organizationId, ctx.organizationId),
        eq(supplierLocations.supplierId, feedstocks.supplierId), eq(supplierLocations.isDefault, true)))
      .leftJoin(supplierLocationFacilityDistances, and(eq(supplierLocationFacilityDistances.organizationId, ctx.organizationId),
        eq(supplierLocationFacilityDistances.locationId, supplierLocations.id), eq(supplierLocationFacilityDistances.facilityId, feedstocks.facilityId)))
      .leftJoin(transportLegs, and(eq(transportLegs.organizationId, ctx.organizationId), eq(transportLegs.entityType, "feedstock"),
        eq(transportLegs.entityId, feedstocks.id), eq(transportLegs.isDerived, true)))
      .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.id, target.entityId)))
    : await tx.select({
      expectedVersion: deliveries.version,
      distanceKmOverride: deliveries.distanceKmOverride,
      recordedDistanceKm: deliveries.recordedDistanceKm,
      recordedDistanceSource: deliveries.recordedDistanceSource,
      currentDistanceKm: customerLocationFacilityDistances.distanceKm,
      currentDistanceSource: customerLocationFacilityDistances.distanceSource,
      locationId: orders.customerLocationId,
      facilityId: deliveries.facilityId,
    }).from(deliveries)
      .innerJoin(orders, and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, deliveries.orderId)))
      .leftJoin(customerLocationFacilityDistances, and(eq(customerLocationFacilityDistances.organizationId, ctx.organizationId),
        eq(customerLocationFacilityDistances.locationId, orders.customerLocationId), eq(customerLocationFacilityDistances.facilityId, deliveries.facilityId)))
      .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, target.entityId)));
  if (!row) throw new DomainError("not_found", "Transport record not found.");
  let hasSubmittedRemoval = false;
  for (const lineageTarget of await distanceRefreshLineageTargets(ctx, tx, target)) {
    if ((await getCertifiedLineage(ctx, tx, lineageTarget)).some(isSubmittedLineageRow)) hasSubmittedRemoval = true;
  }
  return {
    ...target, ...row,
    isOverridden: row.distanceKmOverride != null && row.distanceKmOverride > 0,
    hasDrift: !(row.distanceKmOverride != null && row.distanceKmOverride > 0) && row.recordedDistanceKm !== row.currentDistanceKm,
    hasSubmittedRemoval,
  };
}

