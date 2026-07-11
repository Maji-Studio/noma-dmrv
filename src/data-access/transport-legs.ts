// `transport_legs.entity_id` is polymorphic and not FK-constrained, so every
// read of a single leg and every write resolves the parent chain back to a
// facility via `resolveEntityFacility`. Swap for `requireFacilityAccess` once
// a facility-membership model lands.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import {
  biocharProducts,
  creditBatches,
  customerLocations,
  deliveries,
  facilities,
  feedstocks,
  orders,
  productionRuns,
  samples,
  transportLegs,
  type NewTransportLeg,
  type TransportLeg,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import {
  aggregateDistributionLegs,
  deriveTransportLeg,
  isDerivedLegPersistable,
  positiveOrNull,
  type DerivedTransportLeg,
} from "@/lib/calculations/transport-leg";
import {
  assertCanMutateCertifiedLineage,
  type CertifiedLineageEntityType,
} from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

export type TransportEntityType = TransportEntityTypeValue;

const ENTITY_LABEL: Record<TransportEntityType, string> = {
  feedstock: "Feedstock",
  biochar: "Biochar product",
  sample: "Sample",
};

const CERTIFIED_LINEAGE_TARGET: Record<
  TransportEntityType,
  CertifiedLineageEntityType
> = {
  feedstock: "feedstock",
  biochar: "biocharProduct",
  sample: "sample",
};

// sample resolves indirectly via `production_runs.facility_id`; others have
// a direct `facility_id` column.
async function resolveEntityFacility(
  ctx: OrgContext,
  entityType: TransportEntityType,
  entityId: string,
): Promise<{ facilityId: string }> {
  if (entityType === "feedstock") {
    const [row] = await db
      .select({ facilityId: feedstocks.facilityId })
      .from(feedstocks)
      .where(and(eq(feedstocks.id, entityId), eq(feedstocks.organizationId, ctx.organizationId)));
    if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
    return { facilityId: row.facilityId };
  }

  if (entityType === "biochar") {
    const [row] = await db
      .select({ facilityId: biocharProducts.facilityId })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.id, entityId), eq(biocharProducts.organizationId, ctx.organizationId)));
    if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
    return { facilityId: row.facilityId };
  }

  // sample: samples → credit_batches → facility (issue #309); legacy
  // run-linked rows fall back to samples → production_runs → facility.
  const [row] = await db
    .select({
      batchFacilityId: creditBatches.facilityId,
      runFacilityId: productionRuns.facilityId,
    })
    .from(samples)
    .leftJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .leftJoin(productionRuns, and(eq(samples.productionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .where(and(eq(samples.id, entityId), eq(samples.organizationId, ctx.organizationId)));
  if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
  const facilityId = row.batchFacilityId ?? row.runFacilityId;
  if (!facilityId) {
    throw new SafeError(`${ENTITY_LABEL[entityType]} has no facility`);
  }
  return { facilityId };
}

// ============================================
// Read Operations
// ============================================

export async function getTransportLegsForEntity(
  ctx: OrgContext,
  entityType: TransportEntityType,
  entityId: string,
): Promise<TransportLeg[]> {
  requireOrgScope(ctx);
  await resolveEntityFacility(ctx, entityType, entityId);

  return db
    .select()
    .from(transportLegs)
    .where(
      and(
        eq(transportLegs.entityType, entityType),
        eq(transportLegs.entityId, entityId),
        eq(transportLegs.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(asc(transportLegs.createdAt));
}

// Skips per-entity facility resolution: callers (submission orchestrator,
// Certify-Panel coverage loader) walk the credit-batch lineage and have
// already validated parent access upstream.
export async function getTransportLegsForEntities(
  ctx: OrgContext,
  entityType: TransportEntityType,
  entityIds: string[],
): Promise<TransportLeg[]> {
  requireOrgScope(ctx);
  if (entityIds.length === 0) return [];

  return db
    .select()
    .from(transportLegs)
    .where(
      and(
        eq(transportLegs.entityType, entityType),
        inArray(transportLegs.entityId, entityIds),
        eq(transportLegs.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(asc(transportLegs.createdAt));
}

export async function getTransportLegById(
  ctx: OrgContext,
  id: string,
): Promise<TransportLeg | null> {
  requireOrgScope(ctx);

  const [row] = await db
    .select()
    .from(transportLegs)
    .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)));

  if (!row) return null;
  await resolveEntityFacility(ctx, row.entityType, row.entityId);
  return row;
}

// ============================================
// Write Operations
// ============================================

export type CreateTransportLegInput = Omit<
  NewTransportLeg,
  "id" | "organizationId" | "createdAt" | "updatedAt"
> & {
  entityType: TransportEntityType;
};

export async function createTransportLeg(
  ctx: OrgContext,
  input: CreateTransportLegInput,
): Promise<TransportLeg> {
  requireOrgScope(ctx);

  await resolveEntityFacility(ctx, input.entityType, input.entityId);

  const [row] = await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      {
        entityType: CERTIFIED_LINEAGE_TARGET[input.entityType],
        entityId: input.entityId,
      },
      "create",
    );

    return tx
      .insert(transportLegs)
      .values({
        ...input,
        organizationId: ctx.organizationId,
        entityType: input.entityType,
      })
      .returning();
  });

  if (!row) {
    throw new SafeError("Failed to create transport leg");
  }

  return row;
}

export type UpdateTransportLegInput = Partial<
  Omit<NewTransportLeg, "id" | "organizationId" | "createdAt" | "updatedAt" | "entityType" | "entityId">
>;

export async function updateTransportLeg(
  ctx: OrgContext,
  id: string,
  input: UpdateTransportLegInput,
): Promise<TransportLeg> {
  requireOrgScope(ctx);

  const [existing] = await db
    .select({ entityType: transportLegs.entityType, entityId: transportLegs.entityId })
    .from(transportLegs)
    .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)));
  if (!existing) {
    throw new SafeError("Transport leg not found");
  }
  await resolveEntityFacility(ctx, existing.entityType, existing.entityId);

  const [row] = await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      {
        entityType: CERTIFIED_LINEAGE_TARGET[existing.entityType],
        entityId: existing.entityId,
      },
      "update",
    );

    return tx
      .update(transportLegs)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)))
      .returning();
  });

  if (!row) {
    throw new SafeError("Transport leg not found");
  }

  return row;
}

export async function deleteTransportLeg(
  ctx: OrgContext,
  id: string,
): Promise<void> {
  requireOrgScope(ctx);

  const [existing] = await db
    .select({ entityType: transportLegs.entityType, entityId: transportLegs.entityId })
    .from(transportLegs)
    .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)));
  if (!existing) {
    throw new SafeError("Transport leg not found");
  }
  await resolveEntityFacility(ctx, existing.entityType, existing.entityId);

  const result = await db.transaction(async (tx) => {
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      {
        entityType: CERTIFIED_LINEAGE_TARGET[existing.entityType],
        entityId: existing.entityId,
      },
      "delete",
    );

    return tx
      .delete(transportLegs)
      .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)))
      .returning({ id: transportLegs.id });
  });

  if (result.length === 0) {
    throw new SafeError("Transport leg not found");
  }
}

// Internal cascade helper for parent deletes. `transport_legs.entity_id` is
// polymorphic, so PostgreSQL cannot enforce FK cascades for feedstocks,
// biochar products, or samples.
export async function deleteTransportLegsForEntity(
  tx: DbTransaction,
  entityType: TransportEntityType,
  entityId: string,
): Promise<void> {
  await tx
    .delete(transportLegs)
    .where(
      and(
        eq(transportLegs.entityType, entityType),
        eq(transportLegs.entityId, entityId),
      ),
    );
}

// ============================================
// Auto-derived legs (feedstock)
// ============================================

// Feedstock owns a SINGLE auto-derived leg, computed from records already held
// (supplier/facility + vehicle + mass + stored distance).
// We replace the derived row wholesale on every save: drop the existing derived
// leg for the entity, then insert the new one when it has the hard requirements
// (distance + load mass). Manual legs remain untouched.
export async function replaceDerivedTransportLeg(
  ctx: OrgContext,
  entityType: "feedstock" | "biochar",
  entityId: string,
  derived: DerivedTransportLeg,
): Promise<void> {
  requireOrgScope(ctx);
  await resolveEntityFacility(ctx, entityType, entityId);

  // No persistable derivation → clear any stale derived leg.
  if (!isDerivedLegPersistable(derived)) {
    await db
      .delete(transportLegs)
      .where(
        and(
          eq(transportLegs.entityType, entityType),
          eq(transportLegs.entityId, entityId),
          eq(transportLegs.isDerived, true),
          eq(transportLegs.organizationId, ctx.organizationId),
        ),
      );
    return;
  }

  // Upsert onto the one-derived-per-entity partial unique index
  // (`transport_legs_one_derived_per_entity_idx`) so concurrent resyncs for the
  // same entity converge to a single row instead of racing a delete-then-insert
  // into a unique violation. Manual legs (is_derived = false) are not in the
  // index and are never touched.
  const fields = {
    originName: derived.originName,
    originGpsLatitude: derived.originGpsLatitude,
    originGpsLongitude: derived.originGpsLongitude,
    destinationName: derived.destinationName,
    destinationGpsLatitude: derived.destinationGpsLatitude,
    destinationGpsLongitude: derived.destinationGpsLongitude,
    distanceKm: derived.distanceKm as number,
    distanceSource: derived.distanceSource,
    transportMethodType: derived.transportMethodType,
    calculationMethodType: derived.calculationMethodType,
    vehicleType: derived.vehicleType,
    modelYear: derived.modelYear,
    loadMassKg: derived.loadMassKg as number,
    tripType: derived.tripType,
  };

  await db
    .insert(transportLegs)
    .values({ organizationId: ctx.organizationId, entityType, entityId, isDerived: true, ...fields })
    .onConflictDoUpdate({
      target: [transportLegs.entityType, transportLegs.entityId],
      targetWhere: sql`${transportLegs.isDerived} = true`,
      set: { ...fields, updatedAt: new Date() },
    });
}

// ============================================
// Auto-derived legs (biochar distribution)
// ============================================

/**
 * Recompute and persist a biochar product's SINGLE auto-derived distribution
 * leg (facility → customer sites) from its deliveries. A product can be
 * delivered many times to different distances; the one-derived-per-entity
 * invariant means we store ONE aggregated leg. Aggregation is exact for the
 * distance-based method (`Σ distanceⱼ × massⱼ`): we store the total delivered
 * mass and the mass-weighted-average distance, so `avgDist × totalMass`
 * reproduces `Σ(distⱼ · massⱼ)`. Per delivery, `deliveries.distance_km_override`
 * beats the destination location's stored distance, and each distance carries
 * its `distance_source`; the aggregated leg gets the weakest contributing
 * source. Deliveries missing a positive distance or mass are skipped. Call
 * after every delivery create/update/delete. Manual legs are untouched.
 */
export async function syncBiocharProductTransportLeg(
  ctx: OrgContext,
  biocharProductId: string,
): Promise<void> {
  requireOrgScope(ctx);

  const [facility] = await db
    .select({
      name: facilities.name,
      gpsLatitude: facilities.gpsLatitude,
      gpsLongitude: facilities.gpsLongitude,
    })
    .from(biocharProducts)
    .innerJoin(facilities, and(eq(biocharProducts.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(biocharProducts.id, biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId)));

  if (!facility) {
    // Polymorphic entity_id is not FK-constrained, so a missing facility means
    // an orphaned or invalid product reference. Log the id so operators can
    // trace it; control flow is unchanged (nothing to derive without a source).
    logger.warn(
      { biocharProductId },
      "skipped derived transport leg: biochar product or its facility not found",
    );
    return;
  }

  // The destination location lives on the order in the common flow; the
  // delivery may also carry its own override. Resolve via
  // COALESCE(delivery.customerLocationId, order.customerLocationId).
  const rows = await db
    .select({
      loadMassKg: deliveries.deliveredWetMassKg,
      deliveryDistanceKmOverride: deliveries.distanceKmOverride,
      deliveryDistanceSource: deliveries.distanceSource,
      deliveryTripType: deliveries.tripType,
      locationDistanceKm: customerLocations.distanceFromFacilityKm,
      locationDistanceSource: customerLocations.distanceSource,
      locationName: customerLocations.name,
      locationGpsLatitude: customerLocations.gpsLatitude,
      locationGpsLongitude: customerLocations.gpsLongitude,
    })
    .from(deliveries)
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(
      customerLocations,
      and(
        eq(customerLocations.id, sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(deliveries.biocharProductId, biocharProductId), eq(deliveries.organizationId, ctx.organizationId)));

  // Per delivery: its own distance override (+ source) beats the destination
  // location's stored distance (+ source) — map-integration plan, decision 3.
  const agg = aggregateDistributionLegs(
    rows.map((row) => {
      const override = positiveOrNull(row.deliveryDistanceKmOverride);
      return {
        loadMassKg: row.loadMassKg,
        distanceKm: override ?? row.locationDistanceKm,
        distanceSource:
          override != null
            ? (row.deliveryDistanceSource ?? "manual")
            : row.locationDistanceSource,
        locationName: row.locationName,
        locationGpsLatitude: row.locationGpsLatitude,
        locationGpsLongitude: row.locationGpsLongitude,
        tripType: row.deliveryTripType,
      };
    }),
  );

  const derived = deriveTransportLeg({
    origin: {
      name: facility.name,
      gpsLatitude: facility.gpsLatitude,
      gpsLongitude: facility.gpsLongitude,
    },
    destination: {
      name: agg.destinationName,
      gpsLatitude: agg.destinationGpsLatitude,
      gpsLongitude: agg.destinationGpsLongitude,
    },
    vehicle: null,
    loadMassKg: agg.totalMassKg > 0 ? agg.totalMassKg : null,
    storedDistanceKm: agg.weightedDistanceKm,
    storedDistanceSource: agg.distanceSource,
    tripType: agg.tripType,
  });

  // When no delivery qualifies, `derived` is not persistable and the replace
  // clears any stale derived leg.
  await replaceDerivedTransportLeg(ctx, "biochar", biocharProductId, derived);
}

/**
 * Resync the derived biochar legs of every product delivered to a given
 * customer location. The leg's distance comes from
 * `customer_locations.distance_from_facility_km`, so editing that distance must
 * recompute the affected products' legs. Call after a customer-location update.
 */
export async function syncBiocharLegsForCustomerLocation(
  ctx: OrgContext,
  customerLocationId: string,
): Promise<void> {
  requireOrgScope(ctx);

  // Match deliveries whose resolved destination is this location — either the
  // delivery's own override or, in the common flow, its order's location.
  const rows = await db
    .selectDistinct({ biocharProductId: deliveries.biocharProductId })
    .from(deliveries)
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .where(
      and(
        eq(sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`, customerLocationId),
        eq(deliveries.organizationId, ctx.organizationId),
      ),
    );

  const productIds = rows
    .map((row) => row.biocharProductId)
    .filter((id): id is string => Boolean(id));

  await Promise.all(
    productIds.map((id) => syncBiocharProductTransportLeg(ctx, id)),
  );
}
