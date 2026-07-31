import { describe, expect, it } from "vitest";
import { getCompositionIngredientDraws } from "./biochar-product-composition";

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
