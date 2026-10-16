import { supplierLocationFacilityDistances } from "@/db/schema";
import { recordScopedWriteActivity, resolveWriteActivityScopes } from "./write-activity";
import type { ActivityEventInput } from "./activity-events";
import { assertRowVersion, nextVersion } from "./row-version";
import { deliveryProductAllocations } from "./delivery-allocation-provenance";
import { massGrams } from "./delivery-allocation-math";
// `transport_legs.entity_id` is polymorphic and not FK-constrained, so every
// read of a single leg and every write resolves the parent chain back to a
// facility via `resolveEntityFacility`. Swap for `requireFacilityAccess` once
// a facility-membership model lands.

import { db, type DbTransaction } from "@/db";
import {
  biocharProducts,
  creditBatches,
  customerLocations,
  deliveries,
  facilities,
  feedstocks,
  orders,
  samples,
  supplierLocations,
  suppliers,
  transportLegs,
  vehicles,
  type NewTransportLeg,
  type TransportLeg,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  aggregateDistributionLegs,
  deriveTransportLeg,
  isDerivedLegPersistable,
  resolveDeliveryTransportRoute,
  type DerivedTransportLeg,
} from "@/lib/calculations/transport-leg";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { and, asc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import {
  assertCanMutateCertifiedLineage,
  type CertifiedLineageEntityType,
} from "./certification-lineage-guards";
import {
  retireDocumentsForEntities,
  type DocumentEntityRef,
} from "./documents";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import {
  biocharTransportEvidenceDocumentCount,
  transportEvidenceDocumentCount,
} from "./transport-evidence-projections";
import { requireOrgScope } from "./utils";
import { lockSampleParent } from "./samples/write-scope";

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

const INITIAL_TRANSPORT_LEG_VERSION = 1;
const BIOCHAR_TRANSPORT_AGGREGATE_LOCK_SCOPE =
  "biochar-transport-aggregate";
const BIOCHAR_TRANSPORT_ROUTE_TOPOLOGY_LOCK_SCOPE =
  "biochar-transport-route-topology";

// sample resolves through its credit batch; others have
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

  // sample: samples → credit_batches → facility.
  const [row] = await db
    .select({ facilityId: creditBatches.facilityId })
    .from(samples)
    .innerJoin(creditBatches, and(eq(samples.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)))
    .where(and(eq(samples.id, entityId), eq(samples.organizationId, ctx.organizationId)));
  if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
  const facilityId = row.facilityId;
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
  ctx: OrgContext,
  entityType: TransportEntityType,
) {
  requireOrgScope(ctx);
  const organizationId = ctx.organizationId;
  return entityType === "feedstock"
      ? transportEvidenceDocumentCount(
          organizationId,
          "feedstock",
          "transportLegEntityId",
        )
      : entityType === "sample"
        ? transportEvidenceDocumentCount(
            organizationId,
            "transport_leg",
            "transportLegId",
          )
      : biocharTransportEvidenceDocumentCount(
          ctx,
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
        ctx,
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
        ctx,
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
    if (input.entityType === "sample") {
      // The pre-check above read the parent outside this transaction. A Sample
      // parent takes the Sample writers' full lock scope (artifacts, every
      // batch its lineage reaches, the Sample) and its lineage is re-checked
      // under those locks, so neither a concurrent Sample delete nor a Removal
      // assigned while the leg waited can be missed.
      const parent = await lockSampleParent(ctx, tx, input.entityId, { mutation: "create", subjectEntityType: "transportLeg", lineageRelationship: "linked" });
      if (!parent) throw new SafeError(`${ENTITY_LABEL.sample} not found`);
    } else {
      await assertCanMutateCertifiedLineage(
        ctx,
        tx,
        {
          entityType: CERTIFIED_LINEAGE_TARGET[input.entityType],
          entityId: input.entityId,
        },
        "create",
        "transportLeg",
        "linked",
      );
    }

    const rows = await tx
      .insert(transportLegs)
      .values({
        ...input,
        organizationId: ctx.organizationId,
        entityType: input.entityType,
      })
      .returning();
    const [saved] = rows;
    if (saved) await recordScopedWriteActivity(ctx, tx, {
      entityType: "transport_leg", entityId: saved.id, action: "created", source: "form",
    }, await resolveWriteActivityScopes(ctx, tx, saved.entityType, saved.entityId));
    return rows;
  });

  if (!row) {
    throw new SafeError(
      "The transport leg was not created. Check its details and try again.",
    );
  }

  return row;
}

export type UpdateTransportLegInput = Partial<
  Omit<NewTransportLeg, "id" | "organizationId" | "createdAt" | "updatedAt" | "entityType" | "entityId" | "version">
> & { expectedVersion: number };

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
  if (existing.entityType === "biochar") {
    throw new SafeError("Biochar transport is derived from deliveries. Edit the delivery distance instead.");
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
      "transportLeg",
    );

    // Parent writers take lineage locks before touching their transport legs.
    const [versionRow] = await tx.select().from(transportLegs).where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId))).for("update");
    if (!versionRow) throw new SafeError("Transport leg not found");
    assertRowVersion({ entity: "transportLeg", id, expectedVersion: input.expectedVersion, actualVersion: versionRow.version });
    const rows = await tx
      .update(transportLegs)
      .set({ ...input, version: nextVersion(transportLegs.version), updatedAt: new Date() })
      .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)))
      .returning();
    const [saved] = rows;
    if (saved) await recordScopedWriteActivity(ctx, tx, {
      entityType: "transport_leg", entityId: saved.id, action: "updated", source: "form",
      changedFields: Object.keys(input).filter(field => field !== "expectedVersion" && input[field as keyof typeof input] !== undefined),
    }, await resolveWriteActivityScopes(ctx, tx, saved.entityType, saved.entityId));
    return rows;
  });

  if (!row) {
    throw new SafeError("Transport leg not found");
  }

  return row;
}

export async function deleteTransportLeg(
  ctx: OrgContext,
  id: string,
  expectedVersion: number,
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
      "transportLeg",
    );

    // Parent writers take lineage locks before touching their transport legs.
    const [versionRow] = await tx.select().from(transportLegs).where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId))).for("update");
    if (!versionRow) throw new SafeError("Transport leg not found");
    assertRowVersion({ entity: "transportLeg", id, expectedVersion, actualVersion: versionRow.version });
    const activityScopes = await resolveWriteActivityScopes(ctx, tx, versionRow.entityType, versionRow.entityId);
    await recordScopedWriteActivity(ctx, tx, {
      entityType: "transport_leg", entityId: id, action: "deleted", source: "form",
    }, activityScopes);
    const rows = await tx
      .delete(transportLegs)
      .where(and(eq(transportLegs.id, id), eq(transportLegs.organizationId, ctx.organizationId)))
      .returning({ id: transportLegs.id });
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "transport_leg", entityId: id, activityScopes },
    ], "form");
    return rows;
  });

  if (result.length === 0) {
    throw new SafeError("Transport leg not found");
  }
  await processPendingStorageObjectDeletions(ctx);
}

// Internal cascade helper for parent deletes. `transport_legs.entity_id` is
// polymorphic, so PostgreSQL cannot enforce FK cascades for feedstocks,
// biochar products, or samples.
export async function deleteTransportLegsForEntity(
  ctx: OrgContext,
  tx: DbTransaction,
  entityType: TransportEntityType,
  entityId: string,
  source: ActivityEventInput["source"],
): Promise<DocumentEntityRef[]> {
  requireOrgScope(ctx);
  const scopes = await resolveWriteActivityScopes(ctx, tx, entityType, entityId);
  const legs = await tx.delete(transportLegs).where(and(
    eq(transportLegs.entityType, entityType),
    eq(transportLegs.entityId, entityId),
    eq(transportLegs.organizationId, ctx.organizationId),
  )).returning({ id: transportLegs.id });
  for (const leg of legs) await recordScopedWriteActivity(ctx, tx, {
    entityType: "transport_leg", entityId: leg.id, action: "deleted", source,
  }, scopes);
  return legs.map((leg) => ({
    entityType: "transport_leg",
    entityId: leg.id,
    activityScopes: scopes,
  }));
}

// ============================================
// Auto-derived leg persistence
// ============================================

// Feedstock owns a SINGLE auto-derived leg, computed from records already held
// (supplier/facility + vehicle + mass + stored distance).
// Upsert on every save; clear the row when distance/load mass is
// missing. Manual legs remain untouched.
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
    const scopes = await resolveWriteActivityScopes(ctx, tx, entityType, entityId);
    for (const leg of derivedLegs) await recordScopedWriteActivity(ctx, tx, {
      entityType: "transport_leg", entityId: leg.id, action: "deleted", source: "system", actorUserId: ctx.userId,
    }, scopes);
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
      activityScopes: scopes,
    }));
    if (deferredRetirements) {
      deferredRetirements.push(...retirements);
    } else {
      await retireDocumentsForEntities(ctx, tx, retirements, "system", ctx.userId);
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
  };
  // The caller already holds the parent lock, serializing derived syncs.
  const [existing] = await tx.select().from(transportLegs).where(and(
    eq(transportLegs.organizationId, ctx.organizationId),
    eq(transportLegs.entityType, entityType),
    eq(transportLegs.entityId, entityId),
    eq(transportLegs.isDerived, true),
  ));
  const changedFields = (Object.keys(fields) as (keyof typeof fields)[])
    .filter(key => {
      if (!existing) return true;
      // Compare at PostgreSQL real precision, including its text round-trip.
      if (key === "distanceKm") return Math.fround(existing.distanceKm) !== Math.fround(fields.distanceKm);
      // Aggregated load masses can contain floating-point addition noise.
      if (key === "loadMassKg") return existing.loadMassKg == null || massGrams(existing.loadMassKg) !== massGrams(fields.loadMassKg);
      return existing[key] !== fields[key];
    });
  const [saved] = await tx
    .insert(transportLegs)
    .values({ organizationId: ctx.organizationId, entityType, entityId, isDerived: true, ...fields })
    .onConflictDoUpdate({
      target: [transportLegs.entityType, transportLegs.entityId],
      targetWhere: sql`${transportLegs.isDerived} = true`,
      set: { ...fields, version: nextVersion(transportLegs.version), updatedAt: new Date() },
    }).returning();
  if (!existing || changedFields.length > 0) await recordScopedWriteActivity(ctx, tx, {
    entityType: "transport_leg", entityId: saved.id,
    action: saved.version === INITIAL_TRANSPORT_LEG_VERSION ? "created" : "updated", source: "system", actorUserId: ctx.userId,
    changedFields: saved.version === INITIAL_TRANSPORT_LEG_VERSION ? [] : changedFields,
  }, await resolveWriteActivityScopes(ctx, tx, entityType, entityId));
}

// ============================================
// Auto-derived legs (feedstock)
// ============================================

/**
 * Sync the supplier-to-facility leg from the persisted feedstock override.
 * Derived distances stay frozen unless explicitly refreshed or still missing.
 * The caller owns the transaction and certification guard.
 */
export async function syncFeedstockTransportLeg(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockId: string,
  options?: { refreshFromLocation?: boolean; requireLocationDistance?: boolean },
): Promise<void> {
  requireOrgScope(ctx);

  const [row] = await tx
    .select({
      distanceKmOverride: feedstocks.distanceKmOverride,
      distanceSource: feedstocks.distanceSource,
      supplierName: suppliers.name,
      locationName: supplierLocations.name,
      locationGpsLatitude: supplierLocations.gpsLatitude,
      locationGpsLongitude: supplierLocations.gpsLongitude,
      locationDistanceFromFacilityKm: supplierLocationFacilityDistances.distanceKm,
      locationDistanceSource: supplierLocationFacilityDistances.distanceSource,
      facilityName: facilities.name,
      facilityGpsLatitude: facilities.gpsLatitude,
      facilityGpsLongitude: facilities.gpsLongitude,
      vehicleType: vehicles.vehicleType,
      vehicleModelYear: vehicles.modelYear,
      loadMassKg: feedstocks.massWetKg,
      existingDistanceKm: transportLegs.distanceKm,
      existingDistanceSource: transportLegs.distanceSource,
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
    .leftJoin(supplierLocationFacilityDistances, and(
      eq(supplierLocationFacilityDistances.organizationId, ctx.organizationId),
      eq(supplierLocationFacilityDistances.locationId, supplierLocations.id),
      eq(supplierLocationFacilityDistances.facilityId, feedstocks.facilityId),
    ))
    .where(and(eq(feedstocks.id, feedstockId), eq(feedstocks.organizationId, ctx.organizationId)));

  if (!row) {
    throw new SafeError("Feedstock not found");
  }

  // Validate the same snapshot passed to derivation, before replacing any leg.
  if (options?.requireLocationDistance && row.locationDistanceFromFacilityKm == null) {
    throw new DomainError("validation_failed", "The distance was not refreshed because the location has no distance for this facility. Save a location distance first.");
  }
  const storedDistanceKm = row.locationDistanceFromFacilityKm;
  const storedDistanceSource = row.locationDistanceSource;
  const preserveExistingDistance = !options?.refreshFromLocation && row.existingDistanceKm != null;

  const derived = deriveTransportLeg({
    origin: {
      name: row.locationName ?? row.supplierName,
      gpsLatitude: row.locationGpsLatitude,
      gpsLongitude: row.locationGpsLongitude,
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
    distanceKmOverride: row.distanceKmOverride ?? (preserveExistingDistance ? row.existingDistanceKm : undefined),
    distanceSourceOverride: row.distanceKmOverride != null
      ? row.distanceSource
      : preserveExistingDistance ? row.existingDistanceSource : undefined,
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

  // Every delivery inherits its order's customer location.
  const allocated = deliveryProductAllocations(ctx, tx);
  const rows = await tx
    .select({
      loadMassKg: allocated.wetMassKg,
      distanceKmOverride: deliveries.distanceKmOverride,
      distanceSource: deliveries.distanceSource,
      location: {
        distanceKm: deliveries.recordedDistanceKm,
        distanceSource: deliveries.recordedDistanceSource,
        name: customerLocations.name,
        gpsLatitude: customerLocations.gpsLatitude,
        gpsLongitude: customerLocations.gpsLongitude,
      },
    })
    .from(deliveries)
    .innerJoin(allocated, eq(allocated.deliveryId, deliveries.id))
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(
      customerLocations,
      and(
        eq(customerLocations.id, orders.customerLocationId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(and(
      eq(
        allocated.biocharProductId,
        biocharProductId,
      ),
      eq(deliveries.organizationId, ctx.organizationId),
      eq(deliveries.status, "delivered"),
      isNull(deliveries.archivedAt),
    ));

  // Per delivery: its own distance override (+ source) beats the destination
  // location's stored distance (+ source) — map-integration plan, decision 3.
  const agg = aggregateDistributionLegs(
    rows.map((row) => ({
      loadMassKg: row.loadMassKg,
      ...resolveDeliveryTransportRoute(row),
    })),
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
