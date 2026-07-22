import { describe, expect, it } from "vitest";
import {
  reconcileComposition,
  deriveSuggestedIngredientMassKg,
  deriveMassDeviationPercent,
  fromCompositionJsonb,
  shouldPrefillSuggestedMasses,
  toCompositionJsonb,
} from "@/lib/biochar-composition";
import type { IngredientBin } from "@/lib/biochar-composition";

const ING_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ING_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ING_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const BIN_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const BIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const FT_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const FT_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const FT_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

const feedstockType = (id: string, name: string, category = "compost") => ({
  id,
  name,
  category,
});

describe("reconcileComposition", () => {
  it("preserves storageLocationId and massKg by formulationIngredientId across re-emissions", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, feedstockTypeId: FT_A, feedstockType: feedstockType(FT_A, "Biochar"), ratio: 0.8 },
        { id: ING_B, feedstockTypeId: FT_B, feedstockType: feedstockType(FT_B, "Compost"), ratio: 0.2 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        feedstockTypeId: FT_A,
        feedstockTypeName: "Biochar",
        feedstockTypeCategory: "compost",
        ratio: 0.8,
        massKg: 80,
        storageLocationId: BIN_A,
      },
      {
        formulationIngredientId: ING_B,
        feedstockTypeId: FT_B,
        feedstockTypeName: "Compost",
        feedstockTypeCategory: "compost",
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

  it("ingests authoritative feedstock type metadata and ratio from the formulation", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, feedstockTypeId: FT_A, feedstockType: feedstockType(FT_A, "Biochar v2", "mineral"), ratio: 0.7 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        feedstockTypeId: FT_A,
        feedstockTypeName: "Old Name",
        feedstockTypeCategory: "wrong",
        ratio: 0.99,
        massKg: 50,
        storageLocationId: BIN_A,
      },
    ];

    const next = reconcileComposition(formulation, existing);
    expect(next[0].feedstockTypeName).toBe("Biochar v2");
    expect(next[0].feedstockTypeCategory).toBe("mineral");
    expect(next[0].ratio).toBe(0.7);
    expect(next[0].storageLocationId).toBe(BIN_A);
    expect(next[0].massKg).toBe(50);
  });

  it("clears storageLocationId when the formulation line changes feedstock type", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, feedstockTypeId: FT_B, feedstockType: feedstockType(FT_B, "Compost"), ratio: 0.7 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        feedstockTypeId: FT_A,
        feedstockTypeName: "Biochar",
        feedstockTypeCategory: "compost",
        ratio: 0.99,
        massKg: 50,
        storageLocationId: BIN_A,
      },
    ];

    const next = reconcileComposition(formulation, existing);
    expect(next[0].feedstockTypeId).toBe(FT_B);
    expect(next[0].storageLocationId).toBeNull();
    expect(next[0].massKg).toBe(50);
  });

  it("drops rows for ingredients no longer in the formulation", () => {
    const formulation = {
      ingredients: [
        { id: ING_A, feedstockTypeId: FT_A, feedstockType: feedstockType(FT_A, "Biochar"), ratio: 1 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_B,
        feedstockTypeId: FT_B,
        feedstockTypeName: "Compost",
        feedstockTypeCategory: "compost",
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
        { id: ING_A, feedstockTypeId: FT_A, feedstockType: feedstockType(FT_A, "Biochar"), ratio: 0.5 },
        { id: ING_C, feedstockTypeId: FT_C, feedstockType: feedstockType(FT_C, "New", "amendment"), ratio: 0.5 },
      ],
    };
    const existing: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        feedstockTypeId: FT_A,
        feedstockTypeName: "Biochar",
        feedstockTypeCategory: "compost",
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
        { id: ING_A, feedstockTypeId: FT_A, feedstockType: feedstockType(FT_A, "Biochar"), ratio: 1 },
      ],
    };
    const next = reconcileComposition(formulation, null);
    expect(next).toEqual([
      {
        formulationIngredientId: ING_A,
        feedstockTypeId: FT_A,
        feedstockTypeName: "Biochar",
        feedstockTypeCategory: "compost",
        ratio: 1,
        massKg: null,
        storageLocationId: null,
      },
    ]);
  });
});

describe("deriveSuggestedIngredientMassKg", () => {
  it("computes productMassKg * ingredientRatio", () => {
    expect(deriveSuggestedIngredientMassKg(500, 0.5)).toBeCloseTo(250, 6);
  });

  it("suggests 160 kg for a 0.2 ingredient in an 800 kg product", () => {
    expect(deriveSuggestedIngredientMassKg(800, 0.2)).toBeCloseTo(160, 6);
  });

  it("returns null when any input is null, undefined, zero, or negative", () => {
    expect(deriveSuggestedIngredientMassKg(null, 0.2)).toBeNull();
    expect(deriveSuggestedIngredientMassKg(800, null)).toBeNull();
    expect(deriveSuggestedIngredientMassKg(undefined, 0.2)).toBeNull();
    expect(deriveSuggestedIngredientMassKg(0, 0.2)).toBeNull();
    expect(deriveSuggestedIngredientMassKg(800, 0)).toBeNull();
    expect(deriveSuggestedIngredientMassKg(-1, 0.2)).toBeNull();
  });
});

describe("shouldPrefillSuggestedMasses", () => {
  it("allows suggestions while creating a new product composition", () => {
    expect(
      shouldPrefillSuggestedMasses({
        isEditMode: false,
        initialFormulationId: null,
        selectedFormulationId: ING_A,
      }),
    ).toBe(true);
  });

  it("does not fabricate a null saved mass during an unrelated edit", () => {
    const savedWithNullMass: IngredientBin[] = [
      {
        formulationIngredientId: ING_A,
        feedstockTypeId: FT_A,
        feedstockTypeName: "Compost",
        feedstockTypeCategory: "compost",
        ratio: 0.2,
        massKg: null,
        storageLocationId: BIN_A,
      },
    ];

    expect(
      shouldPrefillSuggestedMasses({
        isEditMode: true,
        initialFormulationId: ING_C,
        selectedFormulationId: ING_C,
      }),
    ).toBe(false);
    expect(toCompositionJsonb(savedWithNullMass, { mode: "update" })).toEqual({
      ingredients: [expect.objectContaining({ massKg: null })],
    });
  });

  it("allows suggestions after an explicit formulation reassignment", () => {
    expect(
      shouldPrefillSuggestedMasses({
        isEditMode: true,
        initialFormulationId: ING_A,
        selectedFormulationId: ING_B,
      }),
    ).toBe(true);
  });
});

describe("deriveMassDeviationPercent", () => {
  it("computes the signed percent deviation vs the suggestion", () => {
    expect(deriveMassDeviationPercent(220, 200)).toBeCloseTo(10, 6);
    expect(deriveMassDeviationPercent(150, 200)).toBeCloseTo(-25, 6);
    expect(deriveMassDeviationPercent(200, 200)).toBeCloseTo(0, 6);
  });

  it("treats an entered zero mass as a full -100% deviation", () => {
    expect(deriveMassDeviationPercent(0, 200)).toBeCloseTo(-100, 6);
  });

  it("returns null when either side is missing or the suggestion is non-positive", () => {
    expect(deriveMassDeviationPercent(null, 200)).toBeNull();
    expect(deriveMassDeviationPercent(undefined, 200)).toBeNull();
    expect(deriveMassDeviationPercent(200, null)).toBeNull();
    expect(deriveMassDeviationPercent(200, 0)).toBeNull();
    expect(deriveMassDeviationPercent(-1, 200)).toBeNull();
    expect(deriveMassDeviationPercent(Number.NaN, 200)).toBeNull();
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
          feedstockTypeId: FT_A,
          feedstockTypeName: "Biochar",
          feedstockTypeCategory: "compost",
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
          feedstockTypeId: FT_A,
          feedstockTypeName: "Biochar",
          feedstockTypeCategory: "compost",
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
    feedstockTypeId: FT_A,
    feedstockTypeName: "Biochar",
    feedstockTypeCategory: "compost",
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
