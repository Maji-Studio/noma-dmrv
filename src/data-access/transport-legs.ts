/**
 * Transport Legs Data Access Layer
 *
 * Polymorphic CRUD operations for the `transport_legs` table, which is the
 * canonical record of transportation emissions across the chain
 * (Isometric Transportation Emissions Accounting Module v1.1).
 *
 * `entityType` discriminates which upstream entity each leg attaches to:
 *   - 'feedstock' → feedstocks.id
 *   - 'biochar'   → biochar_products.id
 *   - 'sample'    → samples.id      (resolves to facility via production_runs)
 *   - 'delivery'  → deliveries.id
 *
 * Authorization model: `transport_legs.entity_id` is polymorphic and not
 * FK-constrained, so every read of a single leg and every write resolves
 * the parent chain back to a facility via `resolveEntityFacility`. This
 * closes the "mutate a leg whose parent doesn't exist" hole. When a
 * facility-membership model lands in this codebase, swap this single
 * helper for a `requireFacilityAccess(userId, facilityId)` check.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  deliveries,
  feedstocks,
  productionRuns,
  samples,
  transportLegs,
  type NewTransportLeg,
  type TransportLeg,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { requireAuth } from "./utils";

export type TransportEntityType = TransportEntityTypeValue;

const ENTITY_LABEL: Record<TransportEntityType, string> = {
  feedstock: "Feedstock",
  biochar: "Biochar product",
  sample: "Sample",
  delivery: "Delivery",
};

/**
 * Walk a polymorphic transport-leg parent back to its facility.
 * Throws SafeError if the parent doesn't resolve.
 *
 * - feedstock / biochar / delivery: direct `facility_id` column.
 * - sample: indirect via `production_runs.facility_id`.
 */
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

  if (entityType === "delivery") {
    const [row] = await db
      .select({ facilityId: deliveries.facilityId })
      .from(deliveries)
      .where(eq(deliveries.id, entityId));
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

/**
 * Get all transport legs attached to a given entity, oldest first.
 * Verifies the parent entity resolves to a facility before issuing the read.
 */
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

/**
 * Bulk fetch transport legs across many entity IDs of the same type.
 * Single query — used by the submission orchestrator and the Certify-Panel
 * coverage loader, both of which walk the credit-batch lineage and have
 * already validated parent access upstream.
 */
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

/**
 * Get a single transport leg by ID. Returns null if the leg doesn't exist
 * OR if its polymorphic parent no longer resolves (orphaned leg).
 */
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
