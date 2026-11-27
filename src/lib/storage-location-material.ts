import { DomainError } from "@/lib/domain-errors";

export const UNCARBONIZED_BIOCHAR_BIN_MESSAGE =
  "Only biochar bins can hold uncarbonized material.";
export const UNCARBONIZED_PRODUCT_SOURCE_MESSAGE =
  "This bin holds uncarbonized material from failed runs. Choose another biochar bin.";

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
