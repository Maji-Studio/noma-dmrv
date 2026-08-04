import { describe, expect, it } from "vitest";
import {
  allocateTrackedDryBiocharKg,
  resolveProductDryBiocharKg,
} from "./biochar-mass-accounting";

describe("conserved dry biochar accounting", () => {
  it("prefers the immutable source allocation over a legacy moisture fallback", () => {
    expect(resolveProductDryBiocharKg({
      sourceAllocatedDryMassKg: 1_800,
      blendMassKg: 4_000,
      biocharMoisturePercent: 40,
      ingredients: [{ massKg: 2_000 }],
    })).toBe(1_800);
  });

  it("falls back to source-biochar wet mass and biochar-only moisture", () => {
    expect(resolveProductDryBiocharKg({
      sourceAllocatedDryMassKg: null,
      blendMassKg: 4_000,
      biocharMoisturePercent: 10,
      ingredients: [{ massKg: 2_000 }],
    })).toBe(1_800);
  });

  it("allocates the same full dry biochar at any finished-product moisture", () => {
    for (const measuredProductMoisture of [5, 20, 40]) {
      expect(measuredProductMoisture).toBeGreaterThanOrEqual(0);
      expect(allocateTrackedDryBiocharKg({
        totalWetKg: 4_000,
        totalDryBiocharKg: 1_800,
        requestedWetKg: 4_000,
      })).toBe(1_800);
    }
  });

  it("allocates partial wet mass proportionally", () => {
    expect(allocateTrackedDryBiocharKg({
      totalWetKg: 4_000,
      totalDryBiocharKg: 1_800,
      requestedWetKg: 1_000,
    })).toBe(450);
  });

  it("carries the exact remaining dry biochar on the final wet allocation", () => {
    expect(allocateTrackedDryBiocharKg({
      totalWetKg: 3,
      totalDryBiocharKg: 1,
      requestedWetKg: 1,
      allocatedWetKg: 2,
      allocatedDryBiocharKg: 0.666,
    })).toBe(0.334);
  });
});
