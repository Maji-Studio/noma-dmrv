import { describe, expect, it } from "vitest";
import {
  biocharProductFormSchema,
  updateBiocharProductSchema,
} from "./biochar-products";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_BIN_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_BIN_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";
const FORMULATION_INGREDIENT_ID = "55555555-5555-4555-8555-555555555555";
const FEEDSTOCK_TYPE_ID = "66666666-6666-4666-8666-666666666666";

function ingredientBin(massKg: number, massDryKg: number) {
  return {
    formulationIngredientId: FORMULATION_INGREDIENT_ID,
    feedstockTypeId: FEEDSTOCK_TYPE_ID,
    feedstockTypeName: "Compost",
    feedstockTypeCategory: "compost",
    massKg,
    massDryKg,
  };
}

describe("biochar product ingredient mass schemas", () => {
  it("attaches a form-schema dry-mass overage to the dry-mass field", () => {
    const result = biocharProductFormSchema.safeParse({
      facilityId: FACILITY_ID,
      sourceBiocharStorageLocationId: SOURCE_BIN_ID,
      storageLocationId: PRODUCT_BIN_ID,
      massKg: 100,
      moistureContentPercent: 10,
      waterAddedKg: 0,
      ingredientBins: [ingredientBin(20, 21)],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["ingredientBins", 0, "massDryKg"],
          }),
        ]),
      );
    }
  });

  it("attaches an update-schema dry-mass overage to the dry-mass field", () => {
    const result = updateBiocharProductSchema.safeParse({
      productId: PRODUCT_ID,
      ingredientBins: [ingredientBin(20, 21)],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["ingredientBins", 0, "massDryKg"],
          }),
        ]),
      );
    }
  });

  it.each([
    ["form", biocharProductFormSchema, {
      facilityId: FACILITY_ID,
      sourceBiocharStorageLocationId: SOURCE_BIN_ID,
      storageLocationId: PRODUCT_BIN_ID,
      massKg: 100,
      moistureContentPercent: 10,
      waterAddedKg: 0,
      ingredientBins: [ingredientBin(20, 20)],
    }],
    ["update", updateBiocharProductSchema, {
      productId: PRODUCT_ID,
      ingredientBins: [ingredientBin(20, 20)],
    }],
  ])("accepts valid %s ingredient masses", (_variant, schema, input) => {
    expect(schema.safeParse(input).success).toBe(true);
  });
});
