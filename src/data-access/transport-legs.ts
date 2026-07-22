// `transport_legs.entity_id` is polymorphic and not FK-constrained, so every
// read of a single leg and every write resolves the parent chain back to a
// facility via `resolveEntityFacility`. Swap for `requireFacilityAccess` once
// a facility-membership model lands.

import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
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
  supplierLocations,
  suppliers,
  transportLegs,
  vehicles,
  type NewTransportLeg,
  type TransportLeg,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
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
import {
  retireDocumentsForEntities,
  type DocumentEntityRef,
} from "./documents";
import {
  biocharTransportEvidenceDocumentCount,
  transportEvidenceDocumentCount,
} from "./transport-evidence-projections";

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

const BIOCHAR_TRANSPORT_AGGREGATE_LOCK_SCOPE =
  "biochar-transport-aggregate";
const BIOCHAR_TRANSPORT_ROUTE_TOPOLOGY_LOCK_SCOPE =
  "biochar-transport-route-topology";

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

export type TransportLegWithEvidence = TransportLeg & {
  transportEvidenceDocumentCount: number;
};

// Accepted transport-evidence count for a leg row, per the category's
// ownership scheme: feedstock evidence lives on the feedstock entity, sample
// evidence on the leg row itself, and biochar evidence on the deliveries the
// auto-derived leg aggregates.
function legEvidenceDocumentCount(
  organizationId: string,
  entityType: TransportEntityType,
) {
  return entityType === "feedstock"
    ? transportEvidenceDocumentCount(
        organizationId,
        "feedstock",
        transportLegs.entityId,
      )
    : entityType === "sample"
      ? transportEvidenceDocumentCount(
          organizationId,
          "transport_leg",
          transportLegs.id,
        )
      : biocharTransportEvidenceDocumentCount(
          organizationId,
          transportLegs.entityId,
        );
}

export async function getTransportLegsForEntity(
  ctx: OrgContext,
  entityType: TransportEntityType,
  entityId: string,
): Promise<TransportLegWithEvidence[]> {
  requireOrgScope(ctx);
  await resolveEntityFacility(ctx, entityType, entityId);

  return db
    .select({
      ...getTableColumns(transportLegs),
      transportEvidenceDocumentCount: legEvidenceDocumentCount(
        ctx.organizationId,
        entityType,
      ),
    })
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

// Same access contract as `getTransportLegsForEntities` (parents validated
// upstream), plus the accepted transport-evidence document count each leg's
// readiness check needs.
export async function getTransportLegsWithEvidenceForEntities(
  ctx: OrgContext,
  entityType: TransportEntityType,
  entityIds: string[],
): Promise<TransportLegWithEvidence[]> {
  requireOrgScope(ctx);
  if (entityIds.length === 0) return [];

  return db
    .select({
      ...getTableColumns(transportLegs),
      transportEvidenceDocumentCount: legEvidenceDocumentCount(
        ctx.organizationId,
        entityType,
      ),
    })
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

    const rows = await tx
      .delete(transportLegs)
      .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)))
      .returning({ id: transportLegs.id });
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "transport_leg", entityId: id },
    ]);
    return rows;
  });

  if (result.length === 0) {
    throw new SafeError("Transport leg not found");
  }
}

// Internal cascade helper for parent deletes. `transport_legs.entity_id` is
// polymorphic, so PostgreSQL cannot enforce FK cascades for feedstocks,
// biochar products, or samples.
export async function deleteTransportLegsForEntity(
  ctx: OrgContext,
  tx: DbTransaction,
  entityType: TransportEntityType,
  entityId: string,
): Promise<DocumentEntityRef[]> {
  requireOrgScope(ctx);
  const legs = await tx
    .select({ id: transportLegs.id })
    .from(transportLegs)
    .where(
      and(
        eq(transportLegs.entityType, entityType),
        eq(transportLegs.entityId, entityId),
        eq(transportLegs.organizationId, ctx.organizationId),
      ),
    );
  await tx
    .delete(transportLegs)
    .where(
      and(
        eq(transportLegs.entityType, entityType),
        eq(transportLegs.entityId, entityId),
        eq(transportLegs.organizationId, ctx.organizationId),
      ),
    );
  return legs.map((leg) => ({
    entityType: "transport_leg",
    entityId: leg.id,
  }));
}

// ============================================
// Auto-derived leg persistence
// ============================================

// Feedstock owns a SINGLE auto-derived leg, computed from records already held
// (supplier/facility + vehicle + mass + stored distance).
// We replace the derived row wholesale on every save: drop the existing derived
// leg for the entity, then insert the new one when it has the hard requirements
// (distance + load mass). Manual legs remain untouched.
async function replaceDerivedTransportLeg(
  ctx: OrgContext,
  tx: DbTransaction,
  entityType: "feedstock" | "biochar",
  entityId: string,
  derived: DerivedTransportLeg,
  deferredRetirements?: DocumentEntityRef[],
): Promise<void> {
  requireOrgScope(ctx);

  // No persistable derivation → clear any stale derived leg.
  if (!isDerivedLegPersistable(derived)) {
    const derivedLegs = await tx
      .select({ id: transportLegs.id })
      .from(transportLegs)
      .where(
        and(
          eq(transportLegs.entityType, entityType),
          eq(transportLegs.entityId, entityId),
          eq(transportLegs.isDerived, true),
          eq(transportLegs.organizationId, ctx.organizationId),
        ),
      )
      .for("update");
    await tx
      .delete(transportLegs)
      .where(
        and(
          eq(transportLegs.entityType, entityType),
          eq(transportLegs.entityId, entityId),
          eq(transportLegs.isDerived, true),
          eq(transportLegs.organizationId, ctx.organizationId),
        ),
      );
    const retirements: DocumentEntityRef[] = derivedLegs.map((leg) => ({
      entityType: "transport_leg",
      entityId: leg.id,
    }));
    if (deferredRetirements) {
      deferredRetirements.push(...retirements);
    } else {
      await retireDocumentsForEntities(ctx, tx, retirements);
    }
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

  await tx
    .insert(transportLegs)
    .values({ organizationId: ctx.organizationId, entityType, entityId, isDerived: true, ...fields })
    .onConflictDoUpdate({
      target: [transportLegs.entityType, transportLegs.entityId],
      targetWhere: sql`${transportLegs.isDerived} = true`,
      set: { ...fields, updatedAt: new Date() },
    });
}

// ============================================
// Auto-derived legs (feedstock)
// ============================================

export interface FeedstockTransportOverride {
  distanceKm?: number | null;
  distanceSource?: "map_estimate" | "manual" | "document" | null;
  tripType?: "return" | "one_way" | null;
  /** Route anchors changed, so the previous route's distance is not reusable. */
  resetDistanceToRoute?: boolean;
}

/**
 * Recompute a feedstock's derived supplier-to-facility leg on the caller's
 * transaction. The form-only distance override is consumed here and persisted
 * only on the derived leg, so no duplicate feedstock column is required.
 */
export async function syncFeedstockTransportLeg(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockId: string,
  distanceOverride?: FeedstockTransportOverride,
): Promise<void> {
  requireOrgScope(ctx);

  const [row] = await tx
    .select({
      supplierName: suppliers.name,
      supplierGpsLatitude: suppliers.gpsLatitude,
      supplierGpsLongitude: suppliers.gpsLongitude,
      supplierDistanceToFacilityKm: suppliers.distanceToFacilityKm,
      supplierDistanceSource: suppliers.distanceSource,
      locationName: supplierLocations.name,
      locationGpsLatitude: supplierLocations.gpsLatitude,
      locationGpsLongitude: supplierLocations.gpsLongitude,
      locationDistanceFromFacilityKm: supplierLocations.distanceFromFacilityKm,
      locationDistanceSource: supplierLocations.distanceSource,
      facilityName: facilities.name,
      facilityGpsLatitude: facilities.gpsLatitude,
      facilityGpsLongitude: facilities.gpsLongitude,
      vehicleType: vehicles.vehicleType,
      vehicleModelYear: vehicles.modelYear,
      loadMassKg: feedstocks.massWetKg,
      existingDistanceKm: transportLegs.distanceKm,
      existingDistanceSource: transportLegs.distanceSource,
      existingTripType: transportLegs.tripType,
    })
    .from(feedstocks)
    .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
    .leftJoin(
      supplierLocations,
      and(
        eq(supplierLocations.supplierId, suppliers.id),
        eq(supplierLocations.isDefault, true),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(facilities, and(eq(feedstocks.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(vehicles, and(eq(feedstocks.vehicleId, vehicles.id), eq(vehicles.organizationId, ctx.organizationId)))
    .leftJoin(
      transportLegs,
      and(
        eq(transportLegs.entityType, "feedstock"),
        eq(transportLegs.entityId, feedstocks.id),
        eq(transportLegs.isDerived, true),
        eq(transportLegs.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!row) {
    throw new SafeError("Feedstock not found");
  }

  const locationDistance = positiveOrNull(row.locationDistanceFromFacilityKm);
  const storedDistanceKm = locationDistance ?? row.supplierDistanceToFacilityKm;
  const storedDistanceSource =
    locationDistance != null
      ? row.locationDistanceSource
      : row.supplierDistanceSource;
  const locationHasGps =
    row.locationGpsLatitude != null && row.locationGpsLongitude != null;
  const preserveExistingDistance =
    distanceOverride?.distanceKm === undefined &&
    distanceOverride?.resetDistanceToRoute !== true;
  const distanceKmOverride = distanceOverride?.resetDistanceToRoute
    ? undefined
    : distanceOverride?.distanceKm;
  const distanceSourceOverride = distanceOverride?.resetDistanceToRoute
    ? undefined
    : distanceOverride?.distanceSource;

  const derived = deriveTransportLeg({
    origin: {
      name: row.locationName ?? row.supplierName,
      gpsLatitude: locationHasGps ? row.locationGpsLatitude : row.supplierGpsLatitude,
      gpsLongitude: locationHasGps ? row.locationGpsLongitude : row.supplierGpsLongitude,
    },
    destination: {
      name: row.facilityName,
      gpsLatitude: row.facilityGpsLatitude,
      gpsLongitude: row.facilityGpsLongitude,
    },
    vehicle: { vehicleType: row.vehicleType, modelYear: row.vehicleModelYear },
    loadMassKg: row.loadMassKg,
    storedDistanceKm,
    storedDistanceSource,
    distanceKmOverride: preserveExistingDistance
      ? row.existingDistanceKm
      : distanceKmOverride,
    distanceSourceOverride:
      distanceSourceOverride !== undefined
        ? distanceSourceOverride
        : preserveExistingDistance
          ? row.existingDistanceSource
          : undefined,
    tripType:
      distanceOverride?.tripType === undefined
        ? row.existingTripType
        : distanceOverride.tripType,
  });

  await replaceDerivedTransportLeg(ctx, tx, "feedstock", feedstockId, derived);
}

// ============================================
// Auto-derived legs (biochar distribution)
// ============================================

/**
 * Serialize mutations that can change which deliveries belong to a product or
 * customer-location route. This is the first transaction lock tier: callers
 * must acquire it before certification, stock, parent-row, and aggregate locks.
 *
 * The organization-wide scope is intentional. Customer-location resync first
 * discovers affected products, so a narrower key could miss a concurrently
 * inserted or repointed delivery before its product identity is known.
 */
export async function lockBiocharTransportRouteTopology(
  ctx: OrgContext,
  tx: DbTransaction,
): Promise<void> {
  requireOrgScope(ctx);
  const lockKey =
    `${BIOCHAR_TRANSPORT_ROUTE_TOPOLOGY_LOCK_SCOPE}:${ctx.organizationId}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}

/**
 * Recompute and persist a biochar product's SINGLE auto-derived distribution
 * leg (facility → customer sites) from its completed deliveries. A product can be
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
async function syncLockedBiocharProductTransportLeg(
  ctx: OrgContext,
  tx: DbTransaction,
  biocharProductId: string,
  deferredRetirements?: DocumentEntityRef[],
): Promise<void> {
  requireOrgScope(ctx);

  const [facility] = await tx
    .select({
      name: facilities.name,
      gpsLatitude: facilities.gpsLatitude,
      gpsLongitude: facilities.gpsLongitude,
    })
    .from(biocharProducts)
    .innerJoin(facilities, and(eq(biocharProducts.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(biocharProducts.id, biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId)));

  if (!facility) {
    throw new SafeError("Biochar product or its facility not found");
  }

  // The destination location lives on the order in the common flow; the
  // delivery may also carry its own override. Resolve via
  // COALESCE(delivery.customerLocationId, order.customerLocationId).
  const rows = await tx
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
    .where(and(
      eq(
        sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
        biocharProductId,
      ),
      eq(deliveries.organizationId, ctx.organizationId),
      eq(deliveries.status, "delivered"),
    ));

  // Per delivery: its own distance override (+ source) beats the destination
  // location's stored distance (+ source) — map-integration plan, decision 3.
  const agg = aggregateDistributionLegs(
    rows.map((row) => {
      const override = positiveOrNull(row.deliveryDistanceKmOverride);
      return {
        loadMassKg: row.loadMassKg,
        distanceKm: override ?? row.locationDistanceKm,
        distanceSource:
          row.deliveryDistanceSource === "document"
            ? "document"
            : override != null
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
  await replaceDerivedTransportLeg(
    ctx,
    tx,
    "biochar",
    biocharProductId,
    derived,
    deferredRetirements,
  );
}

/**
 * Recompute each affected product once on the shared transaction.
 *
 * The org/product transaction locks are acquired together in sorted order,
 * before any product aggregate is read. This lets a waiter observe the prior
 * transaction's committed delivery/location/order changes under READ COMMITTED
 * and prevents two stale snapshots from overwriting the same derived leg.
 * Topology-changing callers take the route-topology lock, followed by any
 * certification/stock/parent row locks. These aggregate locks are the final
 * lock tier and the aggregate reads do not lock parent rows.
 */
export async function syncBiocharProductTransportLegs(
  ctx: OrgContext,
  tx: DbTransaction,
  biocharProductIds: Array<string | null | undefined>,
  deferredRetirements?: DocumentEntityRef[],
): Promise<void> {
  requireOrgScope(ctx);

  const ids = [...new Set(
    biocharProductIds.filter((id): id is string => Boolean(id)),
  )].sort();

  for (const id of ids) {
    const lockKey = `${BIOCHAR_TRANSPORT_AGGREGATE_LOCK_SCOPE}:${ctx.organizationId}:${id}`;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  for (const id of ids) {
    await syncLockedBiocharProductTransportLeg(
      ctx,
      tx,
      id,
      deferredRetirements,
    );
  }
}

/** Recompute one product through the same lock-ordering entry point. */
export async function syncBiocharProductTransportLeg(
  ctx: OrgContext,
  tx: DbTransaction,
  biocharProductId: string,
): Promise<void> {
  requireOrgScope(ctx);
  await syncBiocharProductTransportLegs(ctx, tx, [biocharProductId]);
}

/**
 * Resync the derived biochar legs of every product delivered to a given
 * customer location. The leg's distance comes from
 * `customer_locations.distance_from_facility_km`, so editing that distance must
 * recompute the affected products' legs. Call after a customer-location update.
 */
export async function syncBiocharLegsForCustomerLocation(
  ctx: OrgContext,
  tx: DbTransaction,
  customerLocationId: string,
): Promise<void> {
  requireOrgScope(ctx);

  // Match deliveries whose resolved destination is this location — either the
  // delivery's own override or, in the common flow, its order's location.
  const rows = await tx
    .selectDistinct({
      biocharProductId: sql<string | null>`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
    })
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

  await syncBiocharProductTransportLegs(ctx, tx, productIds);
}
