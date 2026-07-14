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
  requiredMassKgSchema,
  requiredPositiveMassKgSchema,
  optionalMassKgInputSchema,
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
 * Stock-take form. `counted` is what the operator physically counted, in the
 * lane's entry unit (wet kg for a feedstock bin with a moisture estimate,
 * otherwise the lane's native kg). The component converts wet → dry before
 * building the server payload.
 */
export const stockTakeFormSchema = z.object({
  counted: requiredMassKgSchema("Counted stock is required"),
  reason: reasonSchema,
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

export const recordStockTakeSchema = z.object({
  storageLocationId: z.uuid("Invalid storage location ID"),
  lane: z.enum(binMovementLanes),
  reason: reasonSchema,
  // Counted stock in the lane's native unit (dry kg for feedstock).
  countedMassKg: requiredMassKgSchema("Counted stock is required"),
  // Feedstock-only provenance for the dry conversion (snapshot columns).
  countedWetMassKg: optionalMassKgInputSchema(),
  moistureRatioUsed: z.preprocess(
    toNumberOrNull,
    z.number().min(0).max(1).nullable().optional()
  ),
});
export type RecordStockTakeData = z.infer<typeof recordStockTakeSchema>;

export const recordLossSchema = z.object({
  storageLocationId: z.uuid("Invalid storage location ID"),
  lane: z.enum(binMovementLanes),
  reason: reasonSchema,
  lossMassKg: requiredPositiveMassKgSchema(
    "Loss amount is required",
    "Loss amount must be a number",
    "Loss amount must be greater than 0"
  ),
});
export type RecordLossData = z.infer<typeof recordLossSchema>;
