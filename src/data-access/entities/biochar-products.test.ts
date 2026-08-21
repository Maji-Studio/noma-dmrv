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

  it("qualifies both edit-mode availability surfaces as excluding this order", () => {
    expect(
      toBiocharProductEntityOption(
        {
          id: "product-1",
          code: "PB-01",
          name: "North product bin",
          productCode: "BP-01",
          formulationName: null,
          massKg: 3_500,
          waterAddedKg: 0,
          moisturePercent: 15,
          totalDeliveredKg: 500,
          totalDeliveredDryKg: 425,
          unresolvedDeliveredDryCount: 0,
        },
        { excludeCurrentOrder: true },
      ),
    ).toMatchObject({
      remainingMass: {
        wetKg: 3_000,
        dryKg: 2_550,
        labelVariant: "excluding-this-order",
      },
      subtitle:
        "Wet biochar product: 3,000kg | Dry biochar: 2,550kg available excluding this order",
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

  it("subtracts delivery dry biochar directly without a second proportion", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-blend",
        code: "PB-03",
        name: "Blended product bin",
        productCode: "BP-03",
        formulationName: "Biochar Fertilizer",
        massKg: 1_000,
        waterAddedKg: 0,
        moisturePercent: 10,
        composition: {
          ingredients: [{ massKg: 200, massDryKg: 180 }],
        },
        totalDeliveredKg: 500,
        totalDeliveredDryKg: 360,
        unresolvedDeliveredDryCount: 0,
      }).remainingMass,
    ).toEqual({ wetKg: 500, dryKg: 360 });
  });

  it("prefers immutable source allocation dry mass over the legacy fallback", () => {
    expect(
      toBiocharProductEntityOption({
        id: "product-allocated",
        code: "PB-04",
        name: "Allocated product bin",
        productCode: "BP-04",
        formulationName: "Biochar Fertilizer",
        massKg: 4_000,
        waterAddedKg: 0,
        moisturePercent: 40,
        composition: { ingredients: [{ massKg: 2_000 }] },
        sourceAllocatedDryMassKg: 1_800,
        totalDeliveredKg: 1_000,
        totalDeliveredDryKg: 450,
        unresolvedDeliveredDryCount: 0,
      }).remainingMass,
    ).toEqual({ wetKg: 3_000, dryKg: 1_350 });
  });
});
