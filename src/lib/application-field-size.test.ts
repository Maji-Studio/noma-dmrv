import { describe, expect, it } from "vitest";
import { isPositiveApplicationFieldSize } from "./application-field-size";

describe("isPositiveApplicationFieldSize", () => {
  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-positive or non-finite value %s",
    (value) => {
      expect(isPositiveApplicationFieldSize(value)).toBe(false);
    },
  );

  it("accepts a positive finite field size", () => {
    expect(isPositiveApplicationFieldSize(0.1)).toBe(true);
  });
});
