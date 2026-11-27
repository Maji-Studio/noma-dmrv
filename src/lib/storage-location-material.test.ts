import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import {
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
