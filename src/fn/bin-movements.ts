"use server";

/**
 * Bin Movement Server Actions (issue #194)
 *
 * On-demand bin reconciliation: stock-take adjustments and documented losses.
 * The ledger is append-only — there are no update/delete actions. Stock-take
 * deltas are computed server-side against fresh (movement-inclusive) derived
 * stock so the client can't submit a stale delta. For feedstock wet counts the
 * dry figure is likewise recomputed here from the wet count and moisture ratio,
 * so the persisted delta and the snapshot columns can never disagree.
 */

import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/server";
import {
  createBinMovement,
  getBinMovements as getBinMovementsData,
  recordStockTakeMovement,
  type BinMovementWithActor,
} from "@/data-access/bin-movements";
import type { BinMovement } from "@/db/schema";
import {
  recordLossSchema,
  recordStockTakeSchema,
} from "@/schemas/bin-movements";
import type { ActionResult } from "@/types/actions";
import { StockOverdrawError } from "@/data-access/bin-stock-guards";
import { toLoggedActionError } from "./action-errors";

export type RecordLossActionResult =
  | { success: true; data: BinMovement }
  | { success: false; error: string; field?: "lossMassKg" };

function binMovementActionError(
  error: unknown,
  fallbackMessage: string,
  op: string
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "bin movement action failed",
    context: { op },
  });
}

// ============================================
// Read
// ============================================

export async function getBinMovementsFn(
  storageLocationId: string
): Promise<ActionResult<BinMovementWithActor[]>> {
  try {
    const ctx = await requireOrgContext();
    const movements = await getBinMovementsData(ctx, storageLocationId);
    return { success: true, data: movements };
  } catch (error) {
    return {
      success: false,
      error: binMovementActionError(
        error,
        "Failed to load reconciliation history",
        "bin-movement:list"
      ),
    };
  }
}

// ============================================
// Create (append-only)
// ============================================

export async function recordStockTakeFn(
  data: z.infer<typeof recordStockTakeSchema>
): Promise<ActionResult<BinMovement>> {
  try {
    const ctx = await requireOrgContext();

    const validated = recordStockTakeSchema.parse(data);

    // Recompute the dry count server-side from the wet count + snapshot ratio so
    // a stale/tampered client can't submit a dry value inconsistent with its own
    // provenance. A direct dry count (no wet provenance) passes through as-is.
    const countedMassKg =
      validated.countedWetMassKg != null && validated.moistureRatioUsed != null
        ? validated.countedWetMassKg * (1 - validated.moistureRatioUsed)
        : validated.countedMassKg;
    const movement = await recordStockTakeMovement(ctx, {
      storageLocationId: validated.storageLocationId,
      lane: validated.lane,
      reason: validated.reason,
      countedMassKg,
      countedWetMassKg: validated.countedWetMassKg ?? null,
      moistureRatioUsed: validated.moistureRatioUsed ?? null,
    });

    return { success: true, data: movement };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: binMovementActionError(
        error,
        "Failed to record stock-take",
        "bin-movement:stock-take"
      ),
    };
  }
}

export async function recordLossFn(
  data: z.infer<typeof recordLossSchema>
): Promise<RecordLossActionResult> {
  try {
    const ctx = await requireOrgContext();

    const validated = recordLossSchema.parse(data);

    const movement = await createBinMovement(ctx, {
      storageLocationId: validated.storageLocationId,
      lane: validated.lane,
      movementType: "loss",
      // Losses are stored as a negative delta.
      massDeltaKg: -validated.lossMassKg,
      reason: validated.reason,
    });

    return { success: true, data: movement };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    if (error instanceof StockOverdrawError) {
      return { success: false, error: error.message, field: "lossMassKg" };
    }
    return {
      success: false,
      error: binMovementActionError(
        error,
        "Failed to record loss",
        "bin-movement:loss"
      ),
    };
  }
}
