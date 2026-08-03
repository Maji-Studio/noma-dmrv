import { describe, expect, it } from "vitest";
import {
  compositionAllocationChanged,
  deriveCompositionSourceBiocharMassKg,
  getCompositionIngredientDraws,
} from "./biochar-product-composition";

describe("biochar-product ingredient draws", () => {
  it("aggregates positive masses that draw from the same bin", () => {
    expect(
      getCompositionIngredientDraws({
        ingredients: [
          {
            formulationIngredientId: "ingredient-1",
            feedstockTypeId: "feedstock-type-1",
            storageLocationId: "feedstock-bin-1",
            massKg: 40,
          },
          {
            formulationIngredientId: "ingredient-2",
            feedstockTypeId: "feedstock-type-1",
            storageLocationId: "feedstock-bin-1",
            massKg: 30,
          },
          {
            formulationIngredientId: "ingredient-3",
            feedstockTypeId: "feedstock-type-1",
            storageLocationId: "feedstock-bin-2",
            massKg: 0,
          },
        ],
      }),
    ).toEqual([{ storageLocationId: "feedstock-bin-1", massKg: 70 }]);
  });

  it("requires a bin for every positive ingredient mass", () => {
    expect(() =>
      getCompositionIngredientDraws({
        ingredients: [
          {
            formulationIngredientId: "ingredient-1",
            feedstockTypeId: "feedstock-type-1",
            storageLocationId: null,
            massKg: 1,
          },
        ],
      }),
    ).toThrow("Choose a feedstock bin");
  });
});

describe("composition allocation comparison", () => {
  const first = {
    formulationIngredientId: "line-a",
    feedstockTypeId: "type-a",
    feedstockTypeName: "Old name",
    feedstockTypeCategory: "old-category",
    ratio: 0.2,
    storageLocationId: "bin-a",
    massKg: 0.1,
  };
  const second = {
    formulationIngredientId: "line-b",
    feedstockTypeId: "type-b",
    feedstockTypeName: "Second",
    feedstockTypeCategory: "mineral",
    ratio: 0.3,
    storageLocationId: "bin-b",
    massKg: 0.2,
  };

  it("ignores row order, object key order, display metadata, and ratio", () => {
    expect(
      compositionAllocationChanged(
        { ingredients: [first, second] },
        {
          ingredients: [
            {
              massKg: 0.2,
              storageLocationId: "bin-b",
              ratio: 0.9,
              feedstockTypeCategory: "refreshed",
              feedstockTypeName: "Refreshed second",
              feedstockTypeId: "type-b",
              formulationIngredientId: "line-b",
            },
            {
              massKg: 0.1,
              storageLocationId: "bin-a",
              ratio: 0.8,
              feedstockTypeCategory: "refreshed",
              feedstockTypeName: "Refreshed first",
              feedstockTypeId: "type-a",
              formulationIngredientId: "line-a",
            },
          ],
        },
      ),
    ).toBe(false);
  });

  it.each([
    ["formulation line", { ...first, formulationIngredientId: "line-c" }],
    ["feedstock type", { ...first, feedstockTypeId: "type-c" }],
    ["source bin", { ...first, storageLocationId: "bin-c" }],
    ["recorded mass", { ...first, massKg: 0.101 }],
  ])("detects a changed %s", (_label, changed) => {
    expect(
      compositionAllocationChanged(
        { ingredients: [first] },
        { ingredients: [changed] },
      ),
    ).toBe(true);
  });

  it("detects allocation-relevant mass even on a malformed legacy row", () => {
    expect(
      compositionAllocationChanged(
        { ingredients: [] },
        { ingredients: [{ massKg: 1 }] },
      ),
    ).toBe(true);
  });
});

describe("deriveCompositionSourceBiocharMassKg", () => {
  it("totals legacy ingredient mass without requiring a source bin", () => {
    expect(
      deriveCompositionSourceBiocharMassKg(0.3, {
        ingredients: [
          { massKg: 0.1 },
          { massKg: 0.2, storageLocationId: null },
        ],
      }),
    ).toBe(0);
  });
});
