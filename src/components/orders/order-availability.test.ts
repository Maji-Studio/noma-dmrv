import { describe, expect, it } from "vitest";
import { orderAvailabilityWarning } from "./order-availability";

describe("orderAvailabilityWarning", () => {
  it("warns when the ordered quantity exceeds current product stock", () => {
    expect(orderAvailabilityWarning(1_000, 800)).toBe(
      "Only 800 kg is currently available. Reduce the quantity or plan replenishment before fulfilling the order.",
    );
  });

  it("does not warn for an exact, smaller, or incomplete quantity", () => {
    expect(orderAvailabilityWarning(800, 800)).toBeUndefined();
    expect(orderAvailabilityWarning(500, 800)).toBeUndefined();
    expect(orderAvailabilityWarning("", 800)).toBeUndefined();
    expect(orderAvailabilityWarning(1_000, null)).toBeUndefined();
  });

  // Edit mode no longer suppresses: the availability figure it receives is
  // computed with the order's own deliveries excluded (server-side
  // excludeOrderId), so the full-quantity comparison is valid there too.
  it("warns in edit mode when the quantity exceeds self-excluded availability", () => {
    expect(orderAvailabilityWarning(1_000, 400)).toContain(
      "Only 400 kg is currently available",
    );
  });
});
