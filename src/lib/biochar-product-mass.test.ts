import { describe, expect, it } from "vitest";
import { finalWetProductMassKg, sourceBiocharDryMassKg, summarizeBiocharProductMass } from "./biochar-product-mass";

const PRODUCT = {
  massKg: 100,
  waterAddedKg: 20,
  moistureContentPercent: 20,
  composition: {},
  sourceAllocatedDryMassKg: null,
};
const WET_KG = 120;
const DRY_KG = 80;
const SNAPSHOT_DRY_KG = 50;

describe("biochar product mass summaries", () => {
  it("adds water to wet mass without adding dry biochar", () => {
    expect(finalWetProductMassKg(PRODUCT)).toBe(WET_KG);
    expect(sourceBiocharDryMassKg(PRODUCT)).toBe(DRY_KG);
  });

  it("retains the reported wet sum but makes dry mass unknown when one product has null mass", () => {
    const unreported = { ...PRODUCT, massKg: null };
    expect(finalWetProductMassKg(unreported)).toBeNull();
    expect(sourceBiocharDryMassKg(unreported)).toBeNull();
    expect(summarizeBiocharProductMass([PRODUCT, unreported])).toEqual({
      totalWetMassKg: WET_KG,
      totalDryBiocharMassKg: null,
    });
    expect(summarizeBiocharProductMass([unreported])).toEqual({
      totalWetMassKg: null,
      totalDryBiocharMassKg: null,
    });
  });

  it("prefers a dry source allocation even when mass is missing or the allocation is zero", () => {
    expect(summarizeBiocharProductMass([
      { ...PRODUCT, massKg: null, sourceAllocatedDryMassKg: SNAPSHOT_DRY_KG },
      { ...PRODUCT, sourceAllocatedDryMassKg: 0 },
    ])).toEqual({ totalWetMassKg: WET_KG, totalDryBiocharMassKg: SNAPSHOT_DRY_KG });
  });

  it("distinguishes no measurements from measured zero", () => {
    expect(summarizeBiocharProductMass([])).toEqual({
      totalWetMassKg: null, totalDryBiocharMassKg: null,
    });
    expect(summarizeBiocharProductMass([{ ...PRODUCT, massKg: 0, waterAddedKg: 0 }])).toEqual({
      totalWetMassKg: 0, totalDryBiocharMassKg: 0,
    });
  });
});
