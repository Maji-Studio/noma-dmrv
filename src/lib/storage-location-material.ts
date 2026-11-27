import {
  COMPLETED_PRODUCTION_RUN_STATUS,
  FAILED_PRODUCTION_RUN_STATUS,
  type ProductionRunStatus,
} from "@/lib/production-runs/lifecycle";
import { DomainError } from "@/lib/domain-errors";

export const UNCARBONIZED_BIOCHAR_BIN_MESSAGE =
  "Only biochar bins can hold uncarbonized material.";
export const UNCARBONIZED_PRODUCT_SOURCE_MESSAGE =
  "This bin holds uncarbonized material from failed runs. Choose another biochar bin.";

export const FAILED_RUN_OUTPUT_BIN_MESSAGE =
  "Choose an uncarbonized biochar bin for a failed run.";
export const COMPLETE_RUN_OUTPUT_BIN_MESSAGE =
  "A complete run needs a biochar bin without the Uncarbonized tag. Choose another bin.";

/** Validate the effective row, including partial updates that omit the bin type. */
export function assertUncarbonizedBinType(type: string, uncarbonized: boolean): void {
  if (!uncarbonized || type === "biochar_bin") return;
  throw new DomainError("validation_failed", UNCARBONIZED_BIOCHAR_BIN_MESSAGE, {
    issues: [{ path: ["uncarbonized"], code: "validation_failed", message: UNCARBONIZED_BIOCHAR_BIN_MESSAGE }],
  });
}

/** Shared by output-stock previews and product draws under the bin stock lock. */
export function assertCarbonizedProductSource(uncarbonized: boolean): void {
  if (!uncarbonized) return;
  throw new DomainError("validation_failed", UNCARBONIZED_PRODUCT_SOURCE_MESSAGE, {
    issues: [{ path: ["sourceBiocharStorageLocationId"], code: "validation_failed", message: UNCARBONIZED_PRODUCT_SOURCE_MESSAGE }],
  });
}

/** The sole status/bin pairing used by stock reads and terminal-run validation. */
export const PRODUCTION_RUN_STOCK_PAIRS = [
  { status: COMPLETED_PRODUCTION_RUN_STATUS, uncarbonized: false },
  { status: FAILED_PRODUCTION_RUN_STATUS, uncarbonized: true },
] as const;

export function productionRunAddsStock(status: ProductionRunStatus, uncarbonized: boolean): boolean {
  return PRODUCTION_RUN_STOCK_PAIRS.some(pair => pair.status === status && pair.uncarbonized === uncarbonized);
}

export function assertProductionRunOutputBin(status: ProductionRunStatus, uncarbonized: boolean): void {
  if (!PRODUCTION_RUN_STOCK_PAIRS.some(pair => pair.status === status) || productionRunAddsStock(status, uncarbonized)) return;
  const message = status === FAILED_PRODUCTION_RUN_STATUS
    ? FAILED_RUN_OUTPUT_BIN_MESSAGE
    : COMPLETE_RUN_OUTPUT_BIN_MESSAGE;
  throw new DomainError("validation_failed", message, {
    issues: [{ path: ["biocharStorageLocationId"], code: "validation_failed", message }],
  });
}
