import { describe, expect, it } from "vitest";
import { productReferences } from "./biochar-product-write-checks";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("productReferences", () => {
  it("lists every reference in body order with its own pointer and skips an untracked ingredient bin", () => {
    expect(productReferences({
      facilityId: id(1), formulationId: id(2), sourceBiocharStorageLocationId: id(3), storageLocationId: id(4),
      ingredients: [
        { formulationIngredientId: id(5), storageLocationId: id(6), wetMassKg: 1, moisturePercent: 10 },
        { formulationIngredientId: id(7), storageLocationId: null, wetMassKg: 0 },
      ],
    })).toEqual([
      { kind: "facility", id: id(1), path: ["facilityId"] },
      { kind: "formulation", id: id(2), path: ["formulationId"] },
      { kind: "storageLocation", id: id(3), path: ["sourceBiocharStorageLocationId"] },
      { kind: "storageLocation", id: id(4), path: ["storageLocationId"] },
      { kind: "formulationIngredient", id: id(5), path: ["ingredients", 0, "formulationIngredientId"] },
      { kind: "storageLocation", id: id(6), path: ["ingredients", 0, "storageLocationId"] },
      { kind: "formulationIngredient", id: id(7), path: ["ingredients", 1, "formulationIngredientId"] },
    ]);
  });
});
