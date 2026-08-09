import { describe, expect, it } from "vitest";

import {
  MASS_COMPARISON_EPSILON_KG,
  computeClampedDryMass,
  deriveMassDryKg,
  deriveMassDryKgWithAddedWater,
  dryOutputExceedsDryInput,
  exceedsMassWithTolerance,
} from "./mass-dry";

describe("mass-dry calculations", () => {
  describe("deriveMassDryKg", () => {
    it("rounds the derived mass to three decimal places", () => {
      expect(deriveMassDryKg(123.456, 10)).toBe(111.11);
    });

    it.each([
      [-1, 10, "deliveredWetMassKg must be >= 0"],
      [100, -1, "moisturePercent must be between 0 and 100"],
      [100, 101, "moisturePercent must be between 0 and 100"],
    ])(
      "rejects invalid wet mass or moisture (%s kg, %s%%)",
      (wetMassKg, moisturePercent, message) => {
        expect(() => deriveMassDryKg(wetMassKg, moisturePercent)).toThrow(
          new RangeError(message),
        );
      },
    );
  });

  describe("deriveMassDryKgWithAddedWater", () => {
    it("preserves dry matter regardless of added water", () => {
      const baselineDryMassKg = deriveMassDryKg(1_500, 2);

      expect(deriveMassDryKgWithAddedWater(1_500, 2, undefined)).toBe(
        baselineDryMassKg,
      );
      expect(deriveMassDryKgWithAddedWater(1_500, 2, null)).toBe(
        baselineDryMassKg,
      );
      expect(deriveMassDryKgWithAddedWater(1_500, 2, 30)).toBe(
        baselineDryMassKg,
      );
    });

    it.each([-1, Number.NaN, Infinity])(
      "rejects invalid added water: %s",
      (addedWaterKg) => {
        expect(() =>
          deriveMassDryKgWithAddedWater(500, 10, addedWaterKg),
        ).toThrow(
          new RangeError("addedWaterKg must be a finite number >= 0"),
        );
      },
    );
  });

  describe("computeClampedDryMass", () => {
    it("returns a valid dry mass without exceeding wet mass", () => {
      expect(computeClampedDryMass(1_000, 10)).toBe(900);
      expect(computeClampedDryMass(0, 0)).toBe(0);
    });

    it.each([
      [null, 10],
      [undefined, 10],
      [100, null],
      [100, undefined],
      [Number.NaN, 10],
      [Infinity, 10],
      [-1, 10],
      [100, -1],
      [100, 101],
    ])(
      "returns null for unusable inputs (%s, %s)",
      (wetMassKg, moisturePercent) => {
        expect(computeClampedDryMass(wetMassKg, moisturePercent)).toBeNull();
      },
    );
  });

  describe("mass comparison", () => {
    it("allows the epsilon boundary and rejects mass beyond it", () => {
      const referenceMassKg = 100;

      expect(
        exceedsMassWithTolerance(
          referenceMassKg + MASS_COMPARISON_EPSILON_KG,
          referenceMassKg,
        ),
      ).toBe(false);
      expect(
        exceedsMassWithTolerance(
          referenceMassKg + MASS_COMPARISON_EPSILON_KG + 0.000_001,
          referenceMassKg,
        ),
      ).toBe(true);
    });

    it.each([
      { feedstockWetMassKg: null, feedstockMoisturePercent: 10 },
      { feedstockWetMassKg: 100, feedstockMoisturePercent: null },
      { feedstockWetMassKg: undefined, feedstockMoisturePercent: 10 },
      { feedstockWetMassKg: 100, feedstockMoisturePercent: undefined },
    ])(
      "does not report an overage when feedstock inputs are missing",
      (input) => {
        expect(
          dryOutputExceedsDryInput({
            ...input,
            biocharOutputKg: 101,
            biocharMoisturePercent: 0,
          }),
        ).toBe(false);
      },
    );
  });

});
