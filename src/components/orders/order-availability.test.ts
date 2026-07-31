import { describe, expect, it } from "vitest";
import { orderAvailabilityWarning } from "./order-availability";

describe("orderAvailabilityWarning", () => {
  it("warns when the ordered quantity exceeds current product stock", () => {
    expect(orderAvailabilityWarning(1_000, 800)).toBe(
      "Only 800 kg is currently available.",
    );
  });

  it("does not warn for an exact, smaller, or incomplete quantity", () => {
    expect(orderAvailabilityWarning(800, 800)).toBeUndefined();
    expect(orderAvailabilityWarning(500, 800)).toBeUndefined();
    expect(orderAvailabilityWarning("", 800)).toBeUndefined();
    expect(orderAvailabilityWarning(1_000, null)).toBeUndefined();
  });
});
