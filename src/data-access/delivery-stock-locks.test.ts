import { describe, expect, it } from "vitest";
import {
  assertDeliveredWetMass,
  deliveryDrawsStock,
} from "./delivery-stock-locks";

describe("delivery persisted mass state", () => {
  it("uses the stock predicate for positive delivered mass", () => {
    expect(deliveryDrawsStock("delivered", 1)).toBe(true);
    expect(deliveryDrawsStock("delivered", 0)).toBe(false);

    for (const mass of [undefined, null, 0, -1, 0.0004]) {
      expect(() => assertDeliveredWetMass("delivered", mass)).toThrow(
        "Enter a wet mass greater than 0 before marking this delivery as delivered",
      );
    }
    expect(() => assertDeliveredWetMass("delivered", 0.001)).not.toThrow();
  });

  it("allows upcoming rows to omit mass", () => {
    expect(() => assertDeliveredWetMass("upcoming", null)).not.toThrow();
  });
});
