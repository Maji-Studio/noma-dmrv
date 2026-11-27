import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import {
  productionRunAddsStock,
  assertProductionRunOutputBin,
  FAILED_RUN_OUTPUT_BIN_MESSAGE,
  COMPLETE_RUN_OUTPUT_BIN_MESSAGE,
  assertCarbonizedProductSource,
  assertUncarbonizedBinType,
  UNCARBONIZED_BIOCHAR_BIN_MESSAGE,
  UNCARBONIZED_PRODUCT_SOURCE_MESSAGE,
} from "./storage-location-material";

function expectFieldError(work: () => void, field: string, message: string) {
  expect(work).toThrow(DomainError);
  try { work(); } catch (error) {
    expect(error).toMatchObject({ code: "validation_failed", message,
      issues: [{ path: [field], code: "validation_failed", message }] });
  }
}

describe("uncarbonized material guards", () => {
  it.each(["feedstock_bin", "product_bin"])("refuses tagged %s on the tag field", type => {
    expectFieldError(() => assertUncarbonizedBinType(type, true), "uncarbonized", UNCARBONIZED_BIOCHAR_BIN_MESSAGE);
    expect(() => assertUncarbonizedBinType(type, false)).not.toThrow();
  });
  it("allows either tag on a biochar bin", () => {
    for (const tag of [true, false]) expect(() => assertUncarbonizedBinType("biochar_bin", tag)).not.toThrow();
  });
  it("refuses product draws and identifies the source-bin field", () => {
    expectFieldError(() => assertCarbonizedProductSource(true), "sourceBiocharStorageLocationId", UNCARBONIZED_PRODUCT_SOURCE_MESSAGE);
    expect(() => assertCarbonizedProductSource(false)).not.toThrow();
  });
});

it.each([
  ["complete", false, true], ["complete", true, false],
  ["failed", true, true], ["failed", false, false],
  ["running", false, false], ["running", true, false],
  ["cancelled", false, false], ["cancelled", true, false],
] as const)("stock pairing %s / uncarbonized=%s is %s", (status, tag, expected) => {
  expect(productionRunAddsStock(status, tag)).toBe(expected);
  if (status === "complete" || status === "failed") {
    if (expected) expect(() => assertProductionRunOutputBin(status, tag)).not.toThrow();
    else expectFieldError(
      () => assertProductionRunOutputBin(status, tag),
      "biocharStorageLocationId",
      status === "failed" ? FAILED_RUN_OUTPUT_BIN_MESSAGE : COMPLETE_RUN_OUTPUT_BIN_MESSAGE,
    );
  }
});
