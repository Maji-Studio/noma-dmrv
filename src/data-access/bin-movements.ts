/**
 * Bin Movements Data Access Layer (issue #194)
 *
 * Append-only reconciliation ledger: stock-take adjustments and documented
 * losses per bin and material lane. There is deliberately NO update/delete —
 * corrections are compensating movements. Reads are auth-guarded; the signed
 * per-lane sums feed the storage-location derivation overlay.
 */

import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  storageLocations,
  users,
  type BinMovement,
} from "@/db/schema";
import type { BinMovementLane, BinMovementType } from "@/schemas/bin-movements";
import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";

// ============================================
// Types
// ============================================

export interface BinMovementWithActor extends BinMovement {
  /** Display name of the operator who recorded it, or null if unknown/removed. */
  actorName: string | null;
}

export interface BinMovementLaneSum {
  storageLocationId: string;
  lane: BinMovementLane;
  totalDeltaKg: number;
}

export interface CreateBinMovementInput {
  storageLocationId: string;
  lane: BinMovementLane;
  movementType: BinMovementType;
  massDeltaKg: number;
  reason: string;
  countedMassKg?: number | null;
  derivedMassKgAtTime?: number | null;
  countedWetMassKg?: number | null;
  moistureRatioUsed?: number | null;
}

// ============================================
// Read Operations
// ============================================

/**
 * Signed sum of movement deltas per (storage location, lane). Used by the
 * storage-location enrichment overlay to fold documented adjustments/losses
 * into derived stock. Guarded because it is a data-access read.
 */
export async function getBinMovementLaneSums(
  userId: string,
  storageLocationIds: string[]
): Promise<BinMovementLaneSum[]> {
  requireAuth(userId);
  if (storageLocationIds.length === 0) return [];

  const rows = await db
    .select({
      storageLocationId: binMovements.storageLocationId,
      lane: binMovements.lane,
      totalDeltaKg: sql<number>`COALESCE(SUM(${binMovements.massDeltaKg}), 0)`,
    })
    .from(binMovements)
    .where(inArray(binMovements.storageLocationId, storageLocationIds))
    .groupBy(binMovements.storageLocationId, binMovements.lane);

  return rows.map((row) => ({
    storageLocationId: row.storageLocationId,
    lane: row.lane,
    totalDeltaKg: Number(row.totalDeltaKg),
  }));
}

/**
 * Full movement history for a bin, newest first — the verifier-facing audit log.
 */
export async function getBinMovements(
  userId: string,
  storageLocationId: string
): Promise<BinMovementWithActor[]> {
  requireAuth(userId);

  const rows = await db
    .select({
      movement: binMovements,
      actorName: users.name,
    })
    .from(binMovements)
    .leftJoin(users, eq(binMovements.createdBy, users.id))
    .where(eq(binMovements.storageLocationId, storageLocationId))
    .orderBy(desc(binMovements.createdAt));

  return rows.map((row) => ({
    ...row.movement,
    actorName: row.actorName ?? null,
  }));
}

// ============================================
// Create Operations (append-only — no update/delete)
// ============================================

export async function createBinMovement(
  userId: string,
  input: CreateBinMovementInput
): Promise<BinMovement> {
  requireAuth(userId);

  const [location] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(eq(storageLocations.id, input.storageLocationId));

  if (!location) {
    throw new SafeError("Storage location not found");
  }

  // A loss can only ever remove material (DB check mirrors this).
  if (input.movementType === "loss" && input.massDeltaKg >= 0) {
    throw new SafeError("A loss must be a positive amount removed from the bin");
  }

  const [movement] = await db
    .insert(binMovements)
    .values({
      storageLocationId: input.storageLocationId,
      lane: input.lane,
      movementType: input.movementType,
      massDeltaKg: input.massDeltaKg,
      reason: input.reason,
      createdBy: userId,
      countedMassKg: input.countedMassKg ?? null,
      derivedMassKgAtTime: input.derivedMassKgAtTime ?? null,
      countedWetMassKg: input.countedWetMassKg ?? null,
      moistureRatioUsed: input.moistureRatioUsed ?? null,
    })
    .returning();

  return movement;
}

// Re-exported for callers that group sums by location without depending on the
// enrichment module's internals.
export function groupLaneSumsByLocation(
  sums: BinMovementLaneSum[]
): Map<string, Partial<Record<BinMovementLane, number>>> {
  const map = new Map<string, Partial<Record<BinMovementLane, number>>>();
  for (const sum of sums) {
    const existing = map.get(sum.storageLocationId) ?? {};
    existing[sum.lane] = sum.totalDeltaKg;
    map.set(sum.storageLocationId, existing);
  }
  return map;
}
