import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { deliveries, feedstocks, orders, supplierLocations, transportLegs, type Delivery } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { FacilityDistance } from "@/schemas/facility-distances";
import { getCertifiedLineage, lockCertifiedLineageArtifacts, assertLockedLineagesAllowMutation, isSubmittedLineageRow } from "./certification-lineage-guards";
import { deliveryProductAllocations } from "./delivery-allocation-provenance";
import { nextVersion } from "./row-version";
import { syncBiocharProductTransportLegs, syncFeedstockTransportLeg } from "./transport-legs";
import { requireOrgScope } from "./utils";

export interface LocationDistanceFillResult {
  filled: number;
  skipped: { submitted: number; concurrent: number; repointed: number };
}

export type CaptureFilledDelivery = (before: Delivery, after: Delivery) => Promise<void>;

/** Fill missing facts only. A certified lineage is left for deliberate correction. */
export async function fillMissingLocationDistances(
  ctx: OrgContext, tx: DbTransaction, kind: "supplier" | "customer", locationId: string,
  pairs: FacilityDistance[],
  captureDelivery?: CaptureFilledDelivery,
): Promise<LocationDistanceFillResult> {
  requireOrgScope(ctx);
  const result: LocationDistanceFillResult = { filled: 0, skipped: { submitted: 0, concurrent: 0, repointed: 0 } };
  if (pairs.length) {
    if (kind === "customer") await fillDeliveryDistances(ctx, tx, locationId, pairs, result, captureDelivery);
    else await fillFeedstockDistances(ctx, tx, locationId, pairs.map(pair => pair.facilityId), result);
  }
  return result;
}

async function fillDeliveryDistances(ctx: OrgContext, tx: DbTransaction, locationId: string, pairs: FacilityDistance[], result: LocationDistanceFillResult, captureDelivery?: CaptureFilledDelivery) {
  requireOrgScope(ctx);
  const byFacility = new Map(pairs.map(pair => [pair.facilityId, pair]));
  const candidates = await tx.select({ id: deliveries.id, facilityId: deliveries.facilityId }).from(deliveries)
    .innerJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, ctx.organizationId)))
    .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(orders.customerLocationId, locationId),
      isNull(deliveries.archivedAt), isNull(orders.archivedAt),
      inArray(deliveries.facilityId, [...byFacility.keys()]), isNull(deliveries.recordedDistanceKm)))
    .orderBy(asc(deliveries.id));
  // Delivery writers acquire the complete artifact union before delivery rows.
  const lockedKeys = await lockCertifiedLineageArtifacts(ctx, tx,
    candidates.map(row => ({ entityType: "delivery", entityId: row.id })));
  const productIds = new Set<string>();
  for (const candidate of candidates) {
    const pair = byFacility.get(candidate.facilityId)!;
    const target = { entityType: "delivery" as const, entityId: candidate.id };
    const [locked] = await tx.select().from(deliveries)
      .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, candidate.id), isNull(deliveries.archivedAt))).for("update");
    if (!locked || locked.recordedDistanceKm != null) { result.skipped.concurrent++; continue; }
    if ((await getCertifiedLineage(ctx, tx, target)).some(isSubmittedLineageRow)) { result.skipped.submitted++; continue; }
    await assertLockedLineagesAllowMutation(ctx, tx, lockedKeys, [{ target, mutation: "update" }]);
    const [saved] = await tx.update(deliveries).set({
      recordedDistanceKm: pair.distanceKm, recordedDistanceSource: pair.distanceSource,
      version: nextVersion(deliveries.version), updatedAt: new Date(),
    }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, candidate.id),
      isNull(deliveries.recordedDistanceKm))).returning();
    if (!saved) { result.skipped.concurrent++; continue; }
    result.filled++;
    await captureDelivery?.(locked, saved);
    const allocated = deliveryProductAllocations(ctx, tx);
    const rows = await tx.select({ productId: allocated.biocharProductId }).from(allocated)
      // org-scope-ok: deliveryProductAllocations scopes every source to ctx.organizationId.
      .where(eq(allocated.deliveryId, saved.id));
    for (const row of rows) if (row.productId) productIds.add(row.productId);
  }
  if (productIds.size) await syncBiocharProductTransportLegs(ctx, tx, [...productIds]);
}

async function fillFeedstockDistances(ctx: OrgContext, tx: DbTransaction, locationId: string, facilityIds: string[], result: LocationDistanceFillResult) {
  requireOrgScope(ctx);
  const candidates = await tx.select({ id: feedstocks.id, supplierId: feedstocks.supplierId, facilityId: feedstocks.facilityId }).from(feedstocks)
    .innerJoin(supplierLocations, and(eq(supplierLocations.supplierId, feedstocks.supplierId),
      eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.id, locationId), eq(supplierLocations.isDefault, true)))
    .leftJoin(transportLegs, and(eq(transportLegs.organizationId, ctx.organizationId),
      eq(transportLegs.entityType, "feedstock"), eq(transportLegs.entityId, feedstocks.id), eq(transportLegs.isDerived, true)))
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), inArray(feedstocks.facilityId, facilityIds), isNull(feedstocks.archivedAt), isNull(transportLegs.distanceKm)))
    .orderBy(asc(feedstocks.id));
  if (!candidates.length) return;
  // Match intake writers: intake rows before certification artifacts. Lock the
  // complete sets in stable order, including when the form saves several pairs.
  const locked = await tx.select({ id: feedstocks.id, supplierId: feedstocks.supplierId, facilityId: feedstocks.facilityId }).from(feedstocks)
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), inArray(feedstocks.id, candidates.map(row => row.id)), isNull(feedstocks.archivedAt)))
    .orderBy(asc(feedstocks.id)).for("update");
  const lockedKeys = await lockCertifiedLineageArtifacts(ctx, tx,
    locked.map(row => ({ entityType: "feedstock", entityId: row.id })));
  for (const candidate of candidates) {
    const current = locked.find(row => row.id === candidate.id);
    if (!current) { result.skipped.concurrent++; continue; }
    if (current.supplierId !== candidate.supplierId || current.facilityId !== candidate.facilityId) { result.skipped.repointed++; continue; }
    const target = { entityType: "feedstock" as const, entityId: candidate.id };
    if ((await getCertifiedLineage(ctx, tx, target)).some(isSubmittedLineageRow)) { result.skipped.submitted++; continue; }
    await assertLockedLineagesAllowMutation(ctx, tx, lockedKeys, [{ target, mutation: "update" }]);
    const [leg] = await tx.select({ distanceKm: transportLegs.distanceKm }).from(transportLegs)
      .where(and(eq(transportLegs.organizationId, ctx.organizationId), eq(transportLegs.entityType, "feedstock"),
        eq(transportLegs.entityId, candidate.id), eq(transportLegs.isDerived, true))).for("update");
    if (leg?.distanceKm != null) { result.skipped.concurrent++; continue; }
    await syncFeedstockTransportLeg(ctx, tx, candidate.id);
    // A sync can clear a leg when its other required facts are missing.
    const [filled] = await tx.select({ distanceKm: transportLegs.distanceKm }).from(transportLegs)
      .where(and(eq(transportLegs.organizationId, ctx.organizationId), eq(transportLegs.entityType, "feedstock"),
        eq(transportLegs.entityId, candidate.id), eq(transportLegs.isDerived, true)));
    if (filled?.distanceKm != null) result.filled++;
  }
}
