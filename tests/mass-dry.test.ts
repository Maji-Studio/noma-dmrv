import { describe, expect, it } from "vitest";
import {
  computeClampedDryMass,
  deriveMassDryKg,
  resolveDeliveryDryMass,
} from "@/lib/calculations/mass-dry";

describe("Dry mass derivation", () => {
  it("derives dry mass deterministically from wet mass and moisture percent", () => {
    expect(deriveMassDryKg(1000, 10)).toBe(900);
  });

  it("clamps derived dry mass to the wet mass input", () => {
    expect(computeClampedDryMass(1000, 10)).toBe(900);
    expect(computeClampedDryMass(0, 0)).toBe(0);
    expect(computeClampedDryMass(null, 10)).toBeNull();
  });

  it("prioritizes measured dry mass over derived dry mass", () => {
    const result = resolveDeliveryDryMass({
      measuredMassDryKg: 820,
      deliveredWetMassKg: 1000,
      moisturePercent: 20,
    });

    expect(result).toEqual({
      massDryKg: 820,
      source: "measured",
      creditReady: true,
    });
  });

  it("falls back to derived dry mass when measured value is absent", () => {
    const result = resolveDeliveryDryMass({
      deliveredWetMassKg: 500,
      moisturePercent: 5,
    });

    expect(result).toEqual({
      massDryKg: 475,
      source: "derived",
      creditReady: true,
    });
  });

  it("marks records as non-credit-ready when derivation inputs are missing", () => {
    const result = resolveDeliveryDryMass({
      deliveredWetMassKg: 500,
    });

    expect(result.creditReady).toBe(false);
    expect(result.source).toBe("missing");
    expect(result.reason).toContain("moisturePercent");
  });
});
