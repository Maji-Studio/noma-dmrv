"use server";

/**
 * Bin Movement Server Actions (issue #194)
 *
 * On-demand bin reconciliation: stock-take adjustments and documented losses.
 * The ledger is append-only, so there are no update/delete actions and a loss
 * carries a request key: a resubmitted form replays the saved movement, and a
 * key reused with different values answers with a conflict (issue #773). Stock-take
 * deltas are computed server-side against fresh (movement-inclusive) derived
 * stock so the client can't submit a stale delta. For feedstock wet counts, the
 * data-access boundary also recomputes dry mass from the wet count and moisture
 * ratio, so the persisted delta and snapshot columns cannot disagree.
 */

import { getFeedstockBinStock } from "@/data-access/feedstock-bin-ledger";
import { uuidSchema } from "@/schemas/helpers";
import { withAction } from "./with-action";
import type { ConflictRef } from "@/lib/conflict-ref";
import { z } from "zod";
import {
  createBinMovement,
  recordStockTakeMovement,
  StockTakeIncreaseError,
} from "@/data-access/bin-movements";
import type { BinMovement } from "@/db/schema";
import {
  recordLossSchema,
  recordStockTakeSchema,
} from "@/schemas/bin-movements";
import { StockOverdrawError } from "@/data-access/bin-stock-guards";

const LOG_MESSAGE = "bin movement action failed";

export type RecordLossActionResult =
  | { success: true; data: BinMovement }
  | {
      success: false;
      error: string;
      field?: "lossMassKg";
      conflict?: ConflictRef;
    };

export type RecordStockTakeActionResult =
  | { success: true; data: BinMovement }
  | { success: false; error: string; field?: "countedMassKg" };

// ============================================
// Create (append-only)
// ============================================

export async function recordStockTakeFn(
  data: z.infer<typeof recordStockTakeSchema>
): Promise<RecordStockTakeActionResult> {
  return withAction(async (ctx) => {
    const validated = recordStockTakeSchema.parse(data);

    const movement = await recordStockTakeMovement(ctx, {
      storageLocationId: validated.storageLocationId,
      lane: validated.lane,
      reason: validated.reason,
      countedMassKg: validated.countedMassKg,
      countedWetMassKg: validated.countedWetMassKg ?? null,
      moistureRatioUsed: validated.moistureRatioUsed ?? null,
    });

    return movement;
  }, {
    fallbackMessage: "Failed to record stock-take",
    log: { message: LOG_MESSAGE, context: { op: "bin-movement:stock-take" } },
    mapError: (error) =>
      error instanceof StockTakeIncreaseError
        ? { success: false as const, error: error.message, field: "countedMassKg" as const }
        : undefined,
  });
}

export async function recordLossFn(
  data: z.infer<typeof recordLossSchema>
): Promise<RecordLossActionResult> {
  return withAction(async (ctx) => {
    const validated = recordLossSchema.parse(data);

    const movement = await createBinMovement(ctx, {
      storageLocationId: validated.storageLocationId,
      lane: validated.lane,
      movementType: "loss",
      // Losses are stored as a negative delta.
      massDeltaKg: -validated.lossMassKg,
      reason: validated.reason,
      // Replays the saved movement when the operator submits twice.
      idempotencyKey: validated.idempotencyKey,
    });

    return movement;
  }, {
    fallbackMessage: "Failed to record loss",
    log: { message: LOG_MESSAGE, context: { op: "bin-movement:loss" } },
    mapError: (error) =>
      error instanceof StockOverdrawError
        ? { success: false as const, error: error.message, field: "lossMassKg" as const }
        : undefined,
  });
}

/** The pooled feedstock stock card and its complete movement history. */
export async function getFeedstockBinStockFn(storageLocationId: string) {
  return withAction(async (ctx) => getFeedstockBinStock(ctx, uuidSchema().parse(storageLocationId)), {
    log: { message: LOG_MESSAGE, context: { op: "bin-movement:stock" } },
  });
}
