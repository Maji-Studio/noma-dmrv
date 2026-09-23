import { describe, expect, it } from "vitest";
import { formatRemainingMass } from "./remaining-mass";

describe("formatRemainingMass", () => {
  it("formats wet-only feedstock stock with grouped whole kg", () => {
    expect(formatRemainingMass({ wetKg: 3_500.4 })).toBe(
      "Remaining now: 3,500 kg wet",
    );
  });

  it("formats wet and dry biochar product stock in one sentence", () => {
    expect(formatRemainingMass({ wetKg: 3_000, dryKg: 2_900 })).toBe(
      "Remaining now: 3,000 kg wet, 2,900 kg dry biochar",
    );
  });

  it("can show only wet mass when dry mass is not useful for the task", () => {
    expect(formatRemainingMass({ wetKg: 3_000, dryKg: 2_900 }, false)).toBe(
      "Remaining now: 3,000 kg wet",
    );
  });

  it("uses explicit unknown copy for unresolved masses", () => {
    expect(formatRemainingMass({ wetKg: null, dryKg: null })).toBe(
      "Remaining now: wet not recorded, dry biochar not recorded",
    );
  });

  it("qualifies stock that excludes the order being edited", () => {
    expect(
      formatRemainingMass({
        wetKg: 3_000,
        dryKg: 2_900,
        labelVariant: "excluding-this-order",
      }),
    ).toBe("Remaining, excluding this order: 3,000 kg wet, 2,900 kg dry biochar");
  });
});
