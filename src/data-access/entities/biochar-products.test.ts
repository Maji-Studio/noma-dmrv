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
      }),
    ).toEqual({
      id: "product-1",
      code: "PB-01",
      name: "North product bin",
      mass: {
        moisturePercent: 15,
      },
      subtitle:
        "Pure biochar · Wet biochar product: 3,500kg | Dry biochar: 2,975kg available",
    });
  });
});
