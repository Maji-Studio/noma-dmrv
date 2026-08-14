import { describe, expect, it } from "vitest";
import { deriveBlendEffectiveMoisturePercent } from "./composition";
import type { IngredientBin } from "./types";

const ingredient = (massKg: number, massDryKg: number | null): IngredientBin =>
  ({
    storageLocationId: `bin-${massKg}`,
    massKg,
    massDryKg,
  }) as IngredientBin;

describe("deriveBlendEffectiveMoisturePercent", () => {
  // DR-002 / BP-26-001 regression: a blend of 3,000 kg biochar at 34.3%
  // moisture plus 1,000 kg fully-dry ingredient reads neither 34.3% (the
  // biochar-only figure) nor the single-material helper's blend-diluted
  // output — it is 1 − totalDry/totalWet over the whole product.
  it("accounts for ingredient solids in the blend moisture", () => {
    const pct = deriveBlendEffectiveMoisturePercent({
      blendMassKg: 4_000,
      waterAddedKg: 0,
      biocharMoisturePercent: 34.3,
      ingredients: [ingredient(1_000, 1_000)],
      sourceAllocatedDryMassKg: null,
    });
    // biochar dry = 3,000 × (1 − 0.343) = 1,971; total dry = 2,971 over
    // 4,000 wet → 25.725% moisture.
    expect(pct).toBeCloseTo(25.725, 3);
  });

  it("matches the biochar-only moisture for a pure product without water", () => {
    expect(
      deriveBlendEffectiveMoisturePercent({
        blendMassKg: 3_000,
        waterAddedKg: 0,
        biocharMoisturePercent: 34.3,
        ingredients: [],
        sourceAllocatedDryMassKg: null,
      }),
    ).toBeCloseTo(34.3, 6);
  });

  it("dilutes with added water", () => {
    expect(
      deriveBlendEffectiveMoisturePercent({
        blendMassKg: 1_000,
        waterAddedKg: 1_000,
        biocharMoisturePercent: 0,
        ingredients: [],
        sourceAllocatedDryMassKg: null,
      }),
    ).toBeCloseTo(50, 6);
  });

  it("prefers the allocation-tracked dry mass over the moisture derivation", () => {
    expect(
      deriveBlendEffectiveMoisturePercent({
        blendMassKg: 1_000,
        waterAddedKg: 0,
        biocharMoisturePercent: 50,
        ingredients: [],
        sourceAllocatedDryMassKg: 800,
      }),
    ).toBeCloseTo(20, 6);
  });

  it("returns null when the composition cannot account for its dry mass", () => {
    expect(
      deriveBlendEffectiveMoisturePercent({
        blendMassKg: 2_000,
        waterAddedKg: 0,
        biocharMoisturePercent: 20,
        ingredients: [ingredient(500, null)],
        sourceAllocatedDryMassKg: null,
      }),
    ).toBeNull();
    expect(
      deriveBlendEffectiveMoisturePercent({
        blendMassKg: null,
        waterAddedKg: 0,
        biocharMoisturePercent: 20,
        ingredients: [],
        sourceAllocatedDryMassKg: null,
      }),
    ).toBeNull();
  });
});
