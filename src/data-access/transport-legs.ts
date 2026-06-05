// `transport_legs.entity_id` is polymorphic and not FK-constrained, so every
// read of a single leg and every write resolves the parent chain back to a
// facility via `resolveEntityFacility`. Swap for `requireFacilityAccess` once
// a facility-membership model lands.

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  feedstocks,
  productionRuns,
  samples,
  transportLegs,
  type NewTransportLeg,
  type TransportLeg,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import {
  isDerivedLegPersistable,
  type DerivedTransportLeg,
} from "@/lib/calculations/transport-leg";
import { requireAuth } from "./utils";

export type TransportEntityType = TransportEntityTypeValue;

const ENTITY_LABEL: Record<TransportEntityType, string> = {
  feedstock: "Feedstock",
  biochar: "Biochar product",
  sample: "Sample",
};

// sample resolves indirectly via `production_runs.facility_id`; others have
// a direct `facility_id` column.
async function resolveEntityFacility(
  entityType: TransportEntityType,
  entityId: string,
): Promise<{ facilityId: string }> {
  if (entityType === "feedstock") {
    const [row] = await db
      .select({ facilityId: feedstocks.facilityId })
      .from(feedstocks)
      .where(eq(feedstocks.id, entityId));
    if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
    return { facilityId: row.facilityId };
  }

  if (entityType === "biochar") {
    const [row] = await db
      .select({ facilityId: biocharProducts.facilityId })
      .from(biocharProducts)
      .where(eq(biocharProducts.id, entityId));
    if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
    return { facilityId: row.facilityId };
  }

  // sample: samples → production_runs → facilities
  const [row] = await db
    .select({ facilityId: productionRuns.facilityId })
    .from(samples)
    .innerJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
    .where(eq(samples.id, entityId));
  if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
  return { facilityId: row.facilityId };
}

// ============================================
// Read Operations
// ============================================

export async function getTransportLegsForEntity(
  userId: string,
  entityType: TransportEntityType,
  entityId: string,
): Promise<TransportLeg[]> {
  requireAuth(userId);
  await resolveEntityFacility(entityType, entityId);

  return db
    .select()
    .from(transportLegs)
    .where(
      and(
        eq(transportLegs.entityType, entityType),
        eq(transportLegs.entityId, entityId),
      ),
    )
    .orderBy(asc(transportLegs.createdAt));
}

// Skips per-entity facility resolution: callers (submission orchestrator,
// Certify-Panel coverage loader) walk the credit-batch lineage and have
// already validated parent access upstream.
export async function getTransportLegsForEntities(
  userId: string,
  entityType: TransportEntityType,
  entityIds: string[],
): Promise<TransportLeg[]> {
  requireAuth(userId);
  if (entityIds.length === 0) return [];

  return db
    .select()
    .from(transportLegs)
    .where(
      and(
        eq(transportLegs.entityType, entityType),
        inArray(transportLegs.entityId, entityIds),
      ),
    )
    .orderBy(asc(transportLegs.createdAt));
}

export async function getTransportLegById(
  userId: string,
  id: string,
): Promise<TransportLeg | null> {
  requireAuth(userId);

  const [row] = await db
    .select()
    .from(transportLegs)
    .where(eq(transportLegs.id, id));

  if (!row) return null;
  await resolveEntityFacility(row.entityType, row.entityId);
  return row;
}

// ============================================
// Write Operations
// ============================================

export type CreateTransportLegInput = Omit<
  NewTransportLeg,
  "id" | "createdAt" | "updatedAt"
> & {
  entityType: TransportEntityType;
};

export async function createTransportLeg(
  userId: string,
  input: CreateTransportLegInput,
): Promise<TransportLeg> {
  requireAuth(userId);

  await resolveEntityFacility(input.entityType, input.entityId);

  const [row] = await db
    .insert(transportLegs)
    .values({
      ...input,
      entityType: input.entityType,
    })
    .returning();

  if (!row) {
    throw new SafeError("Failed to create transport leg");
  }

  return row;
}

export type UpdateTransportLegInput = Partial<
  Omit<NewTransportLeg, "id" | "createdAt" | "updatedAt" | "entityType" | "entityId">
>;

export async function updateTransportLeg(
  userId: string,
  id: string,
  input: UpdateTransportLegInput,
): Promise<TransportLeg> {
  requireAuth(userId);

  const [existing] = await db
    .select({ entityType: transportLegs.entityType, entityId: transportLegs.entityId })
    .from(transportLegs)
    .where(eq(transportLegs.id, id));
  if (!existing) {
    throw new SafeError("Transport leg not found");
  }
  await resolveEntityFacility(existing.entityType, existing.entityId);

  const [row] = await db
    .update(transportLegs)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(transportLegs.id, id))
    .returning();

  if (!row) {
    throw new SafeError("Transport leg not found");
  }

  return row;
}

export async function deleteTransportLeg(
  userId: string,
  id: string,
): Promise<void> {
  requireAuth(userId);

  const [existing] = await db
    .select({ entityType: transportLegs.entityType, entityId: transportLegs.entityId })
    .from(transportLegs)
    .where(eq(transportLegs.id, id));
  if (!existing) {
    throw new SafeError("Transport leg not found");
  }
  await resolveEntityFacility(existing.entityType, existing.entityId);

  const result = await db
    .delete(transportLegs)
    .where(eq(transportLegs.id, id))
    .returning({ id: transportLegs.id });

  if (result.length === 0) {
    throw new SafeError("Transport leg not found");
  }
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
  userId: string,
  entityType: TransportEntityType,
  entityId: string,
  derived: DerivedTransportLeg,
): Promise<void> {
  requireAuth(userId);
  await resolveEntityFacility(entityType, entityId);

  await db.transaction(async (tx) => {
    await tx
      .delete(transportLegs)
      .where(
        and(
          eq(transportLegs.entityType, entityType),
          eq(transportLegs.entityId, entityId),
          eq(transportLegs.isDerived, true),
        ),
      );

    if (!isDerivedLegPersistable(derived)) return;

    await tx.insert(transportLegs).values({
      entityType,
      entityId,
      isDerived: true,
      originName: derived.originName,
      originGpsLatitude: derived.originGpsLatitude,
      originGpsLongitude: derived.originGpsLongitude,
      destinationName: derived.destinationName,
      destinationGpsLatitude: derived.destinationGpsLatitude,
      destinationGpsLongitude: derived.destinationGpsLongitude,
      distanceKm: derived.distanceKm as number,
      transportMethodType: derived.transportMethodType,
      calculationMethodType: derived.calculationMethodType,
      vehicleType: derived.vehicleType,
      modelYear: derived.modelYear,
      loadMassKg: derived.loadMassKg as number,
    });
  });
}
