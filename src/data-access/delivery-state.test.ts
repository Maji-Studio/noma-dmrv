import { describe, expect, it } from "vitest";
import { assertDeliveredWetMass } from "./delivery-state";

describe("assertDeliveredWetMass", () => {
  it("requires positive mass for delivered rows", () => {
    for (const mass of [undefined, null, 0, -1]) {
      expect(() => assertDeliveredWetMass("delivered", mass)).toThrow(
        "Wet mass must be greater than 0",
      );
    }
    expect(() => assertDeliveredWetMass("delivered", 1)).not.toThrow();
  });

  it("allows upcoming rows to omit mass", () => {
    expect(() => assertDeliveredWetMass("upcoming", null)).not.toThrow();
  });
});
