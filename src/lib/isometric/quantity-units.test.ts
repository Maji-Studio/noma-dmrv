import { describe, expect, it } from "vitest";
import { kilogramUnitsMatch } from "./quantity-units";

describe("kilogramUnitsMatch", () => {
  it.each([
    ["kg", "kg"],
    ["kilogram", "kilogram"],
    ["kg", "kilogram"],
    ["kilogram", "kg"],
  ])("accepts %s and %s as kilogram spellings", (actual, expected) => {
    expect(kilogramUnitsMatch(actual, expected)).toBe(true);
  });

  it.each(["gram", "t/ha", "metric_ton / hectare"])(
    "rejects unrelated unit %s",
    (unit) => {
      expect(kilogramUnitsMatch(unit, "kg")).toBe(false);
    },
  );
});
