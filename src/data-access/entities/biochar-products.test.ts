import { describe, expect, it } from "vitest";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import { toBiocharProductEntityOption } from "./biochar-products";

describe("toBiocharProductEntityOption", () => {
  it("identifies a blended product in the name without repeating it in the subtitle", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-1",
        code: "PB-01",
        name: "Moshi Product Store G",
        productCode: "BP-01",
        formulationName: "Biochar Fertilizer",
        massKg: 3_500,
        waterAddedKg: 0,
        moisturePercent: 15,
        totalDeliveredKg: 0,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 0,
      }),
    ).toMatchObject({
      name: "Moshi Product Store G • Biochar Fertilizer",
      subtitle:
        "Wet biochar product: 3,500kg | Dry biochar: 2,975kg available",
    });
  });

  it("identifies pure biochar by its bin and the shared product label", () => {
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
      }).name,
    ).toBe(`North product bin • ${PURE_BIOCHAR_LABEL}`);
  });

  it("uses only the product label when the bin name is missing", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-1",
        code: "PB-01",
        name: null,
        productCode: "BP-01",
        formulationName: "Biochar Fertilizer",
        massKg: 3_500,
        waterAddedKg: 0,
        moisturePercent: 15,
        totalDeliveredKg: 0,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 0,
      }).name,
    ).toBe("Biochar Fertilizer");
  });

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
      name: `North product bin • ${PURE_BIOCHAR_LABEL}`,
      mass: {
        moisturePercent: 15,
      },
      remainingMass: {
        wetKg: 3_500,
        dryKg: 2_975,
      },
      subtitle:
        "Wet biochar product: 3,500kg | Dry biochar: 2,975kg available",
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

  it("shows zero dry biochar when ingredients consume the whole blend mass", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-legacy-zero",
        code: "PB-00",
        name: "Legacy product bin",
        productCode: "BP-00",
        formulationName: "50/50 blend",
        massKg: 500,
        waterAddedKg: 50,
        moisturePercent: 10,
        composition: {
          ingredients: [
            {
              formulationIngredientId: "ingredient-1",
              feedstockTypeId: "feedstock-type-1",
              feedstockTypeName: "Chicken manure",
              feedstockTypeCategory: "manure",
              ratio: 0.5,
              massKg: 500,
              storageLocationId: null,
            },
          ],
        },
        totalDeliveredKg: 0,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 0,
      }).subtitle,
    ).toBe(
      "Wet biochar product: 550kg | Dry biochar: 0kg available",
    );
  });

  it("uses ingredient mass even when legacy formulation metadata is absent", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-mass-only",
        code: "PB-02",
        name: "Mass-only product bin",
        productCode: "BP-02",
        formulationName: null,
        massKg: 1_000,
        waterAddedKg: 0,
        moisturePercent: 10,
        composition: { ingredients: [{ massKg: 200 }] },
        totalDeliveredKg: 0,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 0,
      }).remainingMass,
    ).toEqual({ wetKg: 1_000, dryKg: 720 });
  });
});
