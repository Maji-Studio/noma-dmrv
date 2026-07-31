import { describe, expect, it } from "vitest";
import { toBiocharProductEntityOption } from "./biochar-products";

describe("toBiocharProductEntityOption", () => {
  it("includes product moisture metadata and explicit remaining wet and dry stock", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-1",
        code: "PB-01",
        name: "North product bin",
        productCode: "BP-01",
        formulationName: null,
        massKg: 3_500,
        waterAddedKg: 0,
        moisturePercent: 15,
        totalDeliveredKg: 0,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 0,
      }),
    ).toEqual({
      id: "product-1",
      code: "PB-01",
      name: "North product bin",
      mass: {
        moisturePercent: 15,
      },
      remainingMass: {
        wetKg: 3_500,
        dryKg: 2_975,
      },
      subtitle:
        "Pure biochar · Wet biochar product: 3,500kg | Dry biochar: 2,975kg available",
    });
  });

  it("exposes moisture against blended product mass for order previews", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-1",
        code: "PB-01",
        name: "North product bin",
        productCode: "BP-01",
        formulationName: null,
        massKg: 100,
        waterAddedKg: 50,
        moisturePercent: 10,
        totalDeliveredKg: 0,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 0,
      }).mass,
    ).toEqual({ moisturePercent: 40 });
  });

  it("keeps remaining dry mass explicit when a delivery has no dry record", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-1",
        code: "PB-01",
        name: "North product bin",
        productCode: "BP-01",
        formulationName: null,
        massKg: 3_500,
        waterAddedKg: 0,
        moisturePercent: 15,
        totalDeliveredKg: 500,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 1,
      }).remainingMass,
    ).toEqual({ wetKg: 3_000, dryKg: null });
  });
});
