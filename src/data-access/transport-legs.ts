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
 *   - 'sample'    → samples.id
 *   - 'delivery'  → deliveries.id
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  deliveries,
  feedstocks,
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

const ENTITY_TABLE = {
  feedstock: feedstocks,
  biochar: biocharProducts,
  sample: samples,
  delivery: deliveries,
} as const;

async function assertEntityExists(
  entityType: TransportEntityType,
  entityId: string,
): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, entityId));
  if (!row) throw new SafeError(`${ENTITY_LABEL[entityType]} not found`);
}

// ============================================
// Read Operations
// ============================================

/**
 * Get all transport legs attached to a given entity, oldest first.
 */
export async function getTransportLegsForEntity(
  userId: string,
  entityType: TransportEntityType,
  entityId: string,
): Promise<TransportLeg[]> {
  requireAuth(userId);

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
 * coverage loader, both of which walk the credit-batch lineage.
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
 * Get a single transport leg by ID.
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

  return row ?? null;
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

  await assertEntityExists(input.entityType, input.entityId);

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

  const result = await db
    .delete(transportLegs)
    .where(eq(transportLegs.id, id))
    .returning({ id: transportLegs.id });

  if (result.length === 0) {
    throw new SafeError("Transport leg not found");
  }
}
