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

  it("does not use the finished-product moisture measurement", () => {
    const allocationInput = {
      totalWetKg: 4_000,
      totalDryBiocharKg: 1_800,
      requestedWetKg: 4_000,
    };

    expect(allocateTrackedDryBiocharKg(allocationInput)).toBe(1_800);
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

  it("allocates partial transfers from the remaining composition", () => {
    expect(allocateTrackedDryBiocharKg({
      totalWetKg: 2_000,
      totalDryBiocharKg: 500,
      requestedWetKg: 750,
      allocatedWetKg: 500,
      allocatedDryBiocharKg: 250,
    })).toBe(125);
  });

  it("refuses allocations above the remaining wet or dry basis", () => {
    expect(allocateTrackedDryBiocharKg({
      totalWetKg: 1_000,
      totalDryBiocharKg: 500,
      requestedWetKg: 300,
      allocatedWetKg: 800,
      allocatedDryBiocharKg: 400,
    })).toBeNull();
    expect(allocateTrackedDryBiocharKg({
      totalWetKg: 1_000,
      totalDryBiocharKg: 500,
      requestedWetKg: 100,
      allocatedWetKg: 800,
      allocatedDryBiocharKg: 501,
    })).toBeNull();
  });

  it("refuses to guess when another dry allocation is unresolved", () => {
    expect(allocateTrackedDryBiocharKg({
      totalWetKg: 1_000,
      totalDryBiocharKg: 500,
      requestedWetKg: 200,
      allocatedWetKg: 300,
      allocatedDryBiocharKg: 0,
      hasUnresolvedDryAllocation: true,
    })).toBeNull();
  });

  it("rounds proportional allocation to exact grams", () => {
    expect(allocateTrackedDryBiocharKg({
      totalWetKg: 3,
      totalDryBiocharKg: 1,
      requestedWetKg: 2,
    })).toBe(0.667);
  });
});
