/**
 * Bin Movements Data Access Layer (issue #194)
 *
 * Append-only reconciliation ledger: stock-take adjustments and documented
 * losses per bin and material lane. There is deliberately NO update/delete —
 * corrections are compensating movements. Reads are auth-guarded; the signed
 * per-lane sums feed the storage-location derivation overlay.
 *
 * Because nothing can be edited away, a loss carries the request key its form
 * instance generated and posts at most once (issue #773); see
 * `./bin-movement-requests`.
 */

import { db, type DbTransaction } from "@/db";
import { isPgCheckViolation } from "@/db/errors";
import {
  binMovements,
  storageLocations,
  users,
  type BinMovement,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { BinMovementLane, BinMovementType } from "@/schemas/bin-movements";
import { laneForStorageType } from "@/schemas/bin-movements";
import { and, desc, eq } from "drizzle-orm";
import {
  findMovementRequest,
  lockMovementRequest,
  requestFingerprint,
} from "./bin-movement-requests";
import {
  deriveBinLaneAvailableKg,
  isOverdraw,
  lockBinStock,
  overdrawError,
} from "./bin-stock-guards";
import { requireOrgScope } from "./utils";

const LOSS_NEGATIVITY_CONSTRAINT = "bin_movements_loss_is_negative";
const LOSS_NEGATIVITY_MESSAGE = "A loss must be recorded as a negative mass delta";
const STOCK_TAKE_INCREASE_MESSAGE =
  "Counted stock cannot exceed the current derived stock. Stock-takes can only confirm or reduce inventory.";
const FEEDSTOCK_SNAPSHOT_MESSAGE =
  "Feedstock stock-takes require wet stock and moisture metadata";
const NON_FEEDSTOCK_SNAPSHOT_MESSAGE =
  "Wet stock and moisture are only valid for feedstock bins";
const LOSS_REPLAY_CONFLICT_MESSAGE =
  "Loss was not saved because this request was already saved with different values. Start a new loss entry.";

// ============================================
// Types
// ============================================

export interface BinMovementWithActor extends BinMovement {
  /** Display name of the operator who recorded it, or null if unknown/removed. */
  actorName: string | null;
}

/** Row-shaped input for the private insert. Only losses carry a request key. */
interface InsertBinMovementInput {
  storageLocationId: string;
  lane: BinMovementLane;
  movementType: BinMovementType;
  massDeltaKg: number;
  reason: string;
  countedMassKg?: number | null;
  derivedMassKgAtTime?: number | null;
  countedWetMassKg?: number | null;
  moistureRatioUsed?: number | null;
  idempotencyKey?: string | null;
  inputSnapshot?: Record<string, unknown> | null;
}

/**
 * A loss is an operator command that a double submit can repeat, so it always
 * carries the request key its open form generated.
 */
export type CreateBinMovementInput = Omit<
  InsertBinMovementInput,
  "idempotencyKey" | "inputSnapshot"
> & { idempotencyKey: string };

export interface RecordStockTakeMovementInput {
  storageLocationId: string;
  lane: BinMovementLane;
  reason: string;
  countedMassKg: number;
  countedWetMassKg?: number | null;
  moistureRatioUsed?: number | null;
}

export class StockTakeIncreaseError extends SafeError {
  constructor() {
    super(STOCK_TAKE_INCREASE_MESSAGE);
    this.name = "StockTakeIncreaseError";
  }
}

// ============================================
// Read Operations
// ============================================

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

/**
 * Assert the target bin exists in this org and physically holds the lane's
 * material. A bin holds one material, so a movement's lane must match the
 * bin's type. Enforced at the trust boundary (every insert) and again before
 * any balance derivation, so a bad target fails with its own error instead of
 * a misleading stock error.
 */
async function assertBinLaneTarget(
  ctx: OrgContext,
  tx: DbTransaction,
  input: Pick<InsertBinMovementInput, "storageLocationId" | "lane">,
): Promise<void> {
  const [location] = await tx
    .select({ id: storageLocations.id, type: storageLocations.type })
    .from(storageLocations)
    .where(and(eq(storageLocations.id, input.storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!location) {
    throw new SafeError("Storage bin not found");
  }

  if (laneForStorageType(location.type) !== input.lane) {
    throw new SafeError("This material does not match the storage bin");
  }
}

async function createBinMovementInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  input: InsertBinMovementInput,
): Promise<BinMovement> {
  await assertBinLaneTarget(ctx, tx, input);

  let movement: BinMovement;
  try {
    [movement] = await tx
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
        idempotencyKey: input.idempotencyKey ?? null,
        inputSnapshot: input.inputSnapshot ?? null,
      })
      .returning();
  } catch (error) {
    if (isPgCheckViolation(error, LOSS_NEGATIVITY_CONSTRAINT)) {
      throw new SafeError(LOSS_NEGATIVITY_MESSAGE);
    }
    throw error;
  }

  return movement;
}

/**
 * Record a documented loss exactly once (issue #773).
 *
 * The ledger is append-only, so a resubmitted form would otherwise post a
 * second deduction. The request key the form instance generated serializes the
 * retry, replays the saved movement when the values match, and refuses a key
 * reused with different values. Reversing a mistaken loss is a separate
 * command that does not exist yet.
 */
export async function createBinMovement(
  ctx: OrgContext,
  input: CreateBinMovementInput,
): Promise<BinMovement> {
  requireOrgScope(ctx);
  if (input.lane !== 'feedstock') throw new SafeError('Use the output stock preview and posting action for output bins.');
  if (input.movementType !== "loss") {
    throw new SafeError(
      "Use Reconcile stock to record a stock-take adjustment",
    );
  }
  const payload = {
    storageLocationId: input.storageLocationId,
    lane: input.lane,
    movementType: input.movementType,
    massDeltaKg: input.massDeltaKg,
    reason: input.reason,
  };
  return db.transaction(async (tx) => {
    // Request key first: a concurrent twin waits here and replays the saved
    // movement instead of queueing behind the bin lock for a second insert.
    await lockMovementRequest(ctx, tx, input.idempotencyKey);
    const existing = await findMovementRequest(ctx, tx, {
      idempotencyKey: input.idempotencyKey,
      payload,
      storageLocationId: input.storageLocationId,
      conflictMessage: LOSS_REPLAY_CONFLICT_MESSAGE,
    });
    if (existing) return existing;

    await lockBinStock(ctx, tx, input.storageLocationId);
    if (input.movementType === "loss" && input.massDeltaKg < 0) {
      // Validate the target first so a bad bin/lane fails with its own error
      // rather than a misleading "not enough stock" for an empty derivation.
      await assertBinLaneTarget(ctx, tx, input);
      const available = await deriveBinLaneAvailableKg(
        ctx,
        tx,
        input.storageLocationId,
        input.lane,
      );
      const requested = Math.abs(input.massDeltaKg);
      if (isOverdraw(requested, available)) {
        throw overdrawError(input.lane);
      }
    }
    return createBinMovementInTransaction(ctx, tx, {
      ...input,
      inputSnapshot: {
        ...payload,
        actorId: ctx.userId,
        payloadHash: requestFingerprint(payload),
      },
    });
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
  if (input.lane !== 'feedstock') throw new SafeError('Use the output stock preview and posting action for output bins.');
  return db.transaction(async (tx) => {
    await lockBinStock(ctx, tx, input.storageLocationId);
    await assertBinLaneTarget(ctx, tx, input);

    let countedMassKg = input.countedMassKg;
    let countedWetMassKg: number | null = null;
    let moistureRatioUsed: number | null = null;
    if (input.lane === "feedstock") {
      if (
        input.countedWetMassKg == null ||
        input.moistureRatioUsed == null ||
        !Number.isFinite(input.countedWetMassKg) ||
        !Number.isFinite(input.moistureRatioUsed) ||
        input.countedWetMassKg < 0 ||
        input.moistureRatioUsed < 0 ||
        input.moistureRatioUsed > 1
      ) {
        throw new SafeError(FEEDSTOCK_SNAPSHOT_MESSAGE);
      }
      countedWetMassKg = input.countedWetMassKg;
      moistureRatioUsed = input.moistureRatioUsed;
      // Feedstock's native stock currency is wet kg. Moisture remains audit
      // metadata and never converts the reconciliation delta or hard limit.
      countedMassKg = input.countedWetMassKg;
    } else if (
      input.countedWetMassKg != null ||
      input.moistureRatioUsed != null
    ) {
      throw new SafeError(NON_FEEDSTOCK_SNAPSHOT_MESSAGE);
    }

    if (!Number.isFinite(countedMassKg) || countedMassKg < 0) {
      throw new SafeError("Counted stock must be a non-negative number");
    }

    const derivedMassKgAtTime = await deriveBinLaneAvailableKg(
      ctx,
      tx,
      input.storageLocationId,
      input.lane,
    );
    if (isOverdraw(countedMassKg, derivedMassKgAtTime)) {
      throw new StockTakeIncreaseError();
    }
    return createBinMovementInTransaction(ctx, tx, {
      storageLocationId: input.storageLocationId,
      lane: input.lane,
      movementType: "adjustment",
      massDeltaKg: countedMassKg - derivedMassKgAtTime,
      reason: input.reason,
      countedMassKg,
      derivedMassKgAtTime,
      countedWetMassKg,
      moistureRatioUsed,
    });
  });
}
