/**
 * Bin Movements Data Access Layer (issue #194)
 *
 * Append-only reconciliation ledger: stock-take adjustments and documented
 * losses per bin and material lane. There is deliberately NO update/delete —
 * corrections are compensating movements. Reads are auth-guarded; the signed
 * per-lane sums feed the storage-location derivation overlay.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  binMovements,
  storageLocations,
  users,
  type BinMovement,
} from "@/db/schema";
import type { BinMovementLane, BinMovementType } from "@/schemas/bin-movements";
import { laneForStorageType } from "@/schemas/bin-movements";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { deriveBinLaneAvailableKg, lockBinStock } from "./bin-stock-guards";

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

export interface RecordStockTakeMovementInput {
  storageLocationId: string;
  lane: BinMovementLane;
  reason: string;
  countedMassKg: number;
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
  ctx: OrgContext,
  storageLocationIds: string[]
): Promise<BinMovementLaneSum[]> {
  requireOrgScope(ctx);
  if (storageLocationIds.length === 0) return [];

  const rows = await db
    .select({
      storageLocationId: binMovements.storageLocationId,
      lane: binMovements.lane,
      totalDeltaKg: sql<number>`COALESCE(SUM(${binMovements.massDeltaKg}), 0)`,
    })
    .from(binMovements)
    .where(and(inArray(binMovements.storageLocationId, storageLocationIds), eq(binMovements.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
  storageLocationId: string
): Promise<BinMovementWithActor[]> {
  requireOrgScope(ctx);

  const rows = await db
    .select({
      movement: binMovements,
      actorName: users.name,
    })
    .from(binMovements)
    .leftJoin(users, eq(binMovements.createdBy, users.id))
    .where(and(eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.organizationId, ctx.organizationId)))
    .orderBy(desc(binMovements.createdAt));

  return rows.map((row) => ({
    ...row.movement,
    actorName: row.actorName ?? null,
  }));
}

// ============================================
// Create Operations (append-only — no update/delete)
// ============================================

async function createBinMovementInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  input: CreateBinMovementInput,
): Promise<BinMovement> {
  const [location] = await tx
    .select({ id: storageLocations.id, type: storageLocations.type })
    .from(storageLocations)
    .where(and(eq(storageLocations.id, input.storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!location) {
    throw new SafeError("Storage location not found");
  }

  // A bin physically holds one material, so a movement's lane must match the
  // bin's type. Enforced here (the trust boundary) so it covers every caller —
  // stock-take and loss alike — not just the paths that check it themselves.
  if (laneForStorageType(location.type) !== input.lane) {
    throw new SafeError("This lane does not match the bin's material type");
  }

  // A loss can only ever remove material (DB check mirrors this).
  if (input.movementType === "loss" && input.massDeltaKg >= 0) {
    throw new SafeError("A loss must be recorded as a negative mass delta");
  }

  const [movement] = await tx
    .insert(binMovements)
    .values({
      organizationId: ctx.organizationId,
      storageLocationId: input.storageLocationId,
      lane: input.lane,
      movementType: input.movementType,
      massDeltaKg: input.massDeltaKg,
      reason: input.reason,
      createdBy: ctx.userId,
      countedMassKg: input.countedMassKg ?? null,
      derivedMassKgAtTime: input.derivedMassKgAtTime ?? null,
      countedWetMassKg: input.countedWetMassKg ?? null,
      moistureRatioUsed: input.moistureRatioUsed ?? null,
    })
    .returning();

  return movement;
}

export async function createBinMovement(
  ctx: OrgContext,
  input: CreateBinMovementInput,
): Promise<BinMovement> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    await lockBinStock(ctx, tx, input.storageLocationId);
    return createBinMovementInTransaction(ctx, tx, input);
  });
}

/**
 * Record a physical count against stock derived inside the same locked
 * transaction. The lock is shared with every withdrawal guard, so the delta is
 * always based on the latest committed stock and cannot double-apply.
 */
export async function recordStockTakeMovement(
  ctx: OrgContext,
  input: RecordStockTakeMovementInput,
): Promise<BinMovement> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    await lockBinStock(ctx, tx, input.storageLocationId);
    const derivedMassKgAtTime = await deriveBinLaneAvailableKg(
      ctx,
      tx,
      input.storageLocationId,
      input.lane,
    );
    return createBinMovementInTransaction(ctx, tx, {
      storageLocationId: input.storageLocationId,
      lane: input.lane,
      movementType: "adjustment",
      massDeltaKg: input.countedMassKg - derivedMassKgAtTime,
      reason: input.reason,
      countedMassKg: input.countedMassKg,
      derivedMassKgAtTime,
      countedWetMassKg: input.countedWetMassKg ?? null,
      moistureRatioUsed: input.moistureRatioUsed ?? null,
    });
  });
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
