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
      expect(() => assertDeliveredWetMass("delivered", mass, "DL-001")).toThrow(
        "Delivery DL-001 needs a wet mass of at least 0.001 kg before it can be marked as delivered.",
      );
    }
    expect(() =>
      assertDeliveredWetMass("delivered", 0.001, "DL-001"),
    ).not.toThrow();
  });

  it("allows upcoming rows to omit mass", () => {
    expect(() =>
      assertDeliveredWetMass("upcoming", null, "DL-001"),
    ).not.toThrow();
  });
});
