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
import { getUser } from "@/lib/auth/server";
import {
  createBinMovement,
  getBinMovements as getBinMovementsData,
  type BinMovementWithActor,
} from "@/data-access/bin-movements";
import { getStorageLocationWithFacility as getStorageLocationWithFacilityData } from "@/data-access/storage-locations";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { BinMovement } from "@/db/schema";
import {
  recordLossSchema,
  recordStockTakeSchema,
  laneForStorageType,
  type BinMovementLane,
} from "@/schemas/bin-movements";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

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

/** Current derived on-hand mass for a bin's lane (movement-inclusive). */
function laneDerivedMassKg(
  entity: StorageLocationWithFacility,
  lane: BinMovementLane
): number {
  if (lane === "feedstock") return entity.feedstockInventory.currentDryMassKg;
  if (lane === "biochar") return entity.biocharInventory.currentMassKg;
  return entity.productInventory.currentMassKg;
}

// ============================================
// Read
// ============================================

export async function getBinMovementsFn(
  storageLocationId: string
): Promise<ActionResult<BinMovementWithActor[]>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }
    const movements = await getBinMovementsData(user.id, storageLocationId);
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = recordStockTakeSchema.parse(data);

    // Recompute derived stock server-side so the delta reflects the latest
    // state (including prior movements), not whatever the client last saw.
    const entity = await getStorageLocationWithFacilityData(
      user.id,
      validated.storageLocationId
    );
    if (laneForStorageType(entity.type) !== validated.lane) {
      return {
        success: false,
        error: "This lane does not match the bin's material type",
      };
    }

    const derivedMassKgAtTime = laneDerivedMassKg(entity, validated.lane);
    // Recompute the dry count server-side from the wet count + snapshot ratio so
    // a stale/tampered client can't submit a dry value inconsistent with its own
    // provenance. A direct dry count (no wet provenance) passes through as-is.
    const countedMassKg =
      validated.countedWetMassKg != null && validated.moistureRatioUsed != null
        ? validated.countedWetMassKg * (1 - validated.moistureRatioUsed)
        : validated.countedMassKg;
    const massDeltaKg = countedMassKg - derivedMassKgAtTime;

    const movement = await createBinMovement(user.id, {
      storageLocationId: validated.storageLocationId,
      lane: validated.lane,
      movementType: "adjustment",
      massDeltaKg,
      reason: validated.reason,
      countedMassKg,
      derivedMassKgAtTime,
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
): Promise<ActionResult<BinMovement>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = recordLossSchema.parse(data);

    const movement = await createBinMovement(user.id, {
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
