import { describe, expect, it } from "vitest";
import {
  reconcileComposition,
  deriveBinRemovalKg,
  fromCompositionJsonb,
  toCompositionJsonb,
} from "@/lib/biochar-composition";
import type { IngredientBin } from "@/lib/biochar-composition";

const ING_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ING_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ING_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const BIN_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const BIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

describe("reconcileComposition", () => {
  it("preserves storageLocationId and massKg by formulationIngredientId across re-emissions", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, name: "Biochar", ingredientType: "biochar", ratio: 0.8 },
        { id: ING_B, name: "Compost", ingredientType: "compost", ratio: 0.2 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        ingredientName: "Biochar",
        ingredientType: "biochar",
        ratio: 0.8,
        massKg: 80,
        storageLocationId: BIN_A,
      },
      {
        formulationIngredientId: ING_B,
        ingredientName: "Compost",
        ingredientType: "compost",
        ratio: 0.2,
        massKg: 20,
        storageLocationId: BIN_B,
      },
    ];

    const next = reconcileComposition(formulation, existing);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ formulationIngredientId: ING_A, storageLocationId: BIN_A, massKg: 80 });
    expect(next[1]).toMatchObject({ formulationIngredientId: ING_B, storageLocationId: BIN_B, massKg: 20 });
  });

  it("ingests authoritative name/type/ratio from the formulation, overwriting prior values", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, name: "Biochar v2", ingredientType: "biochar", ratio: 0.7 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        ingredientName: "Old Name",
        ingredientType: "wrong",
        ratio: 0.99,
        massKg: 50,
        storageLocationId: BIN_A,
      },
    ];

    const next = reconcileComposition(formulation, existing);
    expect(next[0].ingredientName).toBe("Biochar v2");
    expect(next[0].ingredientType).toBe("biochar");
    expect(next[0].ratio).toBe(0.7);
    expect(next[0].storageLocationId).toBe(BIN_A);
    expect(next[0].massKg).toBe(50);
  });

  it("drops rows for ingredients no longer in the formulation", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, name: "Biochar", ingredientType: "biochar", ratio: 1 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_B,
        ingredientName: "Compost",
        ingredientType: "compost",
        ratio: 0.2,
        massKg: 20,
        storageLocationId: BIN_B,
      },
    ];

    const next = reconcileComposition(formulation, existing);
    expect(next).toHaveLength(1);
    expect(next[0].formulationIngredientId).toBe(ING_A);
  });

  it("adds new ingredients with null bin and mass", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, name: "Biochar", ingredientType: "biochar", ratio: 0.5 },
        { id: ING_C, name: "New", ingredientType: "amendment", ratio: 0.5 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        ingredientName: "Biochar",
        ingredientType: "biochar",
        ratio: 0.5,
        massKg: 50,
        storageLocationId: BIN_A,
      },
    ];

    const next = reconcileComposition(formulation, existing);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      formulationIngredientId: ING_C,
      storageLocationId: null,
      massKg: null,
    });
  });

  it("returns rows from a formulation when there are no existing rows", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, name: "Biochar", ingredientType: "biochar", ratio: 1 },
      ],
    };
    const next = reconcileComposition(formulation, null);
    expect(next).toEqual([
      {
        formulationIngredientId: ING_A,
        ingredientName: "Biochar",
        ingredientType: "biochar",
        ratio: 1,
        massKg: null,
        storageLocationId: null,
      },
    ]);
  });
});

describe("deriveBinRemovalKg", () => {
  it("computes (productMassKg / biocharRatio) * ingredientRatio", () => {
    expect(deriveBinRemovalKg(800, 0.8, 0.2)).toBeCloseTo(200, 6);
    expect(deriveBinRemovalKg(500, 1, 0.5)).toBeCloseTo(250, 6);
  });

  it("returns null when any input is null, undefined, zero, or negative", () => {
    expect(deriveBinRemovalKg(null, 0.8, 0.2)).toBeNull();
    expect(deriveBinRemovalKg(800, null, 0.2)).toBeNull();
    expect(deriveBinRemovalKg(800, 0.8, null)).toBeNull();
    expect(deriveBinRemovalKg(undefined, 0.8, 0.2)).toBeNull();
    expect(deriveBinRemovalKg(0, 0.8, 0.2)).toBeNull();
    expect(deriveBinRemovalKg(800, 0, 0.2)).toBeNull();
    expect(deriveBinRemovalKg(800, 0.8, 0)).toBeNull();
    expect(deriveBinRemovalKg(-1, 0.8, 0.2)).toBeNull();
  });
});

describe("fromCompositionJsonb", () => {
  it("returns [] for empty object, null, undefined, and missing ingredients", () => {
    expect(fromCompositionJsonb({})).toEqual([]);
    expect(fromCompositionJsonb(null)).toEqual([]);
    expect(fromCompositionJsonb(undefined)).toEqual([]);
    expect(fromCompositionJsonb({ other: 1 })).toEqual([]);
  });

  it("returns [] when ingredients is not an array", () => {
    expect(fromCompositionJsonb({ ingredients: "nope" })).toEqual([]);
    expect(fromCompositionJsonb({ ingredients: 42 })).toEqual([]);
  });

  it("returns the ingredients array when shape is valid", () => {
    const stored = {
      ingredients: [
        {
          formulationIngredientId: ING_A,
          ingredientName: "Biochar",
          ingredientType: "biochar",
          ratio: 1,
          massKg: 100,
          storageLocationId: BIN_A,
        },
      ],
    };
    expect(fromCompositionJsonb(stored)).toEqual(stored.ingredients);
  });

  it("filters out malformed entries that lack formulationIngredientId", () => {
    const stored = {
      ingredients: [
        { foo: "bar" },
        {
          formulationIngredientId: ING_A,
          ingredientName: "Biochar",
          ingredientType: "biochar",
          ratio: 1,
          massKg: 100,
          storageLocationId: BIN_A,
        },
      ],
    };
    const out = fromCompositionJsonb(stored);
    expect(out).toHaveLength(1);
    expect(out[0].formulationIngredientId).toBe(ING_A);
  });
});

describe("toCompositionJsonb", () => {
  const bin: IngredientBin = {
    formulationIngredientId: ING_A,
    ingredientName: "Biochar",
    ingredientType: "biochar",
    ratio: 1,
    massKg: 100,
    storageLocationId: BIN_A,
  };

  describe("create mode", () => {
    it("returns {} when bins is undefined or empty", () => {
      expect(toCompositionJsonb(undefined, { mode: "create" })).toEqual({});
      expect(toCompositionJsonb([], { mode: "create" })).toEqual({});
    });

    it("returns { ingredients: [...] } when bins is non-empty", () => {
      expect(toCompositionJsonb([bin], { mode: "create" })).toEqual({ ingredients: [bin] });
    });
  });

  describe("update mode (partial semantics)", () => {
    it("returns undefined when bins is undefined (omit = preserve existing)", () => {
      expect(toCompositionJsonb(undefined, { mode: "update" })).toBeUndefined();
    });

    it("returns {} when bins is an empty array (clear)", () => {
      expect(toCompositionJsonb([], { mode: "update" })).toEqual({});
    });

    it("returns { ingredients: [...] } when bins is non-empty (replace)", () => {
      expect(toCompositionJsonb([bin], { mode: "update" })).toEqual({ ingredients: [bin] });
    });
  });
});
