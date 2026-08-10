/**
 * Bin Movement Validation Schemas (issue #194)
 *
 * Two operator-facing flows write to the append-only reconciliation ledger:
 * a stock-take (counted stock → computed adjustment) and a documented loss.
 * Client form schemas validate the raw operator input; server action schemas
 * validate the assembled payload.
 */

import { z } from "zod";
import {
  massKgSchema,
  optionalCanonicalizableMassKgInputSchema,
  optionalPercent,
  requiredCanonicalizableMassKgSchema,
  requiredMassKgSchema,
  requiredPositiveMassKgSchema,
  toNumberOrNull,
} from "./helpers";
import { type StorageLocationType } from "./storage-locations";

// ============================================
// Constants
// ============================================

/** Material lanes a movement can apply to — one per storage-location type. */
export const binMovementLanes = ["feedstock", "biochar", "product"] as const;
export type BinMovementLane = (typeof binMovementLanes)[number];

export const binMovementTypes = ["adjustment", "loss"] as const;
export type BinMovementType = (typeof binMovementTypes)[number];

const STORAGE_TYPE_TO_LANE: Record<StorageLocationType, BinMovementLane> = {
  feedstock_bin: "feedstock",
  biochar_bin: "biochar",
  product_bin: "product",
};

const LANE_TO_STORAGE_TYPE: Record<BinMovementLane, StorageLocationType> = {
  feedstock: "feedstock_bin",
  biochar: "biochar_bin",
  product: "product_bin",
};

/** The single material lane a bin reconciles, derived from its type. */
export function laneForStorageType(type: StorageLocationType): BinMovementLane {
  return STORAGE_TYPE_TO_LANE[type];
}

export function storageTypeForLane(lane: BinMovementLane): StorageLocationType {
  return LANE_TO_STORAGE_TYPE[lane];
}

export const BIN_MOVEMENT_LANE_LABELS: Record<BinMovementLane, string> = {
  feedstock: "Feedstock",
  biochar: "Biochar",
  product: "Product",
};

export const BIN_MOVEMENT_TYPE_LABELS: Record<BinMovementType, string> = {
  adjustment: "Stock-take adjustment",
  loss: "Loss / write-off",
};

const REASON_MAX = 1000;
const reasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required")
  .max(REASON_MAX, `Reason must be ${REASON_MAX} characters or less`);

// ============================================
// Client Form Schemas
// ============================================

/**
 * Stock-take form. `counted` is always wet kg for feedstock and the lane's
 * native kg otherwise. Feedstock counts may retain a moisture measurement as
 * snapshot metadata, but the reconciliation delta remains wet kg.
 */
export const stockTakeFormSchema = z
  .object({
    lane: z.enum(binMovementLanes),
    counted: requiredCanonicalizableMassKgSchema("Counted stock is required"),
    moisturePercent: optionalPercent,
    reason: reasonSchema,
  })
  .superRefine((data, ctx) => {
    if (data.lane === "feedstock" && data.moisturePercent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["moisturePercent"],
        message: "Moisture content is required",
      });
    }

    if (data.lane !== "feedstock") {
      const persistedMass = massKgSchema().safeParse(data.counted);
      if (!persistedMass.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counted"],
          message: persistedMass.error.issues[0]?.message ?? "Enter a valid mass.",
        });
      }
    }
  });
export type StockTakeFormData = z.infer<typeof stockTakeFormSchema>;

/** Loss form. `lossMassKg` is the (positive) amount removed. */
export const recordLossFormSchema = z.object({
  lossMassKg: requiredPositiveMassKgSchema(
    "Loss amount is required",
    "Loss amount must be a number",
    "Loss amount must be greater than 0"
  ),
  reason: reasonSchema,
});
export type RecordLossFormData = z.infer<typeof recordLossFormSchema>;

// ============================================
// Server Action Schemas
// ============================================

export const recordStockTakeSchema = z
  .object({
    storageLocationId: z.uuid("Choose a valid storage bin."),
    lane: z.enum(binMovementLanes),
    reason: reasonSchema,
    // Lane-native count. For feedstock this is the same wet value as the
    // snapshot below; moisture does not convert the stock currency.
    countedMassKg: requiredMassKgSchema("Counted stock is required"),
    // Feedstock-only snapshot provenance.
    countedWetMassKg: optionalCanonicalizableMassKgInputSchema(),
    moistureRatioUsed: z.preprocess(
      toNumberOrNull,
      z.number().min(0).max(1).nullable().optional()
    ),
  })
  .superRefine((data, ctx) => {
    if (data.lane === "feedstock") {
      if (data.countedWetMassKg == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["countedWetMassKg"],
          message: "Counted wet stock is required for a feedstock bin",
        });
      }
      if (data.moistureRatioUsed == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["moistureRatioUsed"],
          message: "Moisture content is required for a feedstock bin",
        });
      }
    } else if (
      data.countedWetMassKg != null ||
      data.moistureRatioUsed != null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["countedWetMassKg"],
        message: "Wet stock and moisture are only valid for feedstock bins",
      });
    }
  });
export type RecordStockTakeData = z.infer<typeof recordStockTakeSchema>;

export const recordLossSchema = z.object({
  storageLocationId: z.uuid("Choose a valid storage bin."),
  lane: z.enum(binMovementLanes),
  reason: reasonSchema,
  lossMassKg: requiredPositiveMassKgSchema(
    "Loss amount is required",
    "Loss amount must be a number",
    "Loss amount must be greater than 0"
  ),
});
export type RecordLossData = z.infer<typeof recordLossSchema>;
