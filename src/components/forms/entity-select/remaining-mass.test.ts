import { describe, expect, it } from "vitest";
import { formatRemainingMass } from "./remaining-mass";

describe("formatRemainingMass", () => {
  it("formats wet-only feedstock stock with grouped whole compact kg", () => {
    expect(formatRemainingMass({ wetKg: 3_500.4 })).toBe(
      "Remaining wet mass: 3,500kg",
    );
  });

  it("formats wet and dry biochar product stock with the required separator", () => {
    expect(formatRemainingMass({ wetKg: 3_000, dryKg: 2_900 })).toBe(
      "Remaining wet mass: 3,000kg | dry mass: 2,900kg",
    );
  });

  it("can show only wet mass when dry mass is not useful for the task", () => {
    expect(formatRemainingMass({ wetKg: 3_000, dryKg: 2_900 }, false)).toBe(
      "Remaining wet mass: 3,000kg",
    );
  });

  it("uses explicit unknown copy for unresolved dry mass", () => {
    expect(formatRemainingMass({ wetKg: 3_000, dryKg: null })).toBe(
      "Remaining wet mass: 3,000kg | dry mass: Not recorded",
    );
  });
});
