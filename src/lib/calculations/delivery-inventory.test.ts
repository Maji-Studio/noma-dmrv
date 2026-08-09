import { describe, expect, it } from "vitest";

import {
  calculateAvailableKg,
  checkDeliveryCapacity,
} from "./delivery-inventory";

describe("delivery inventory calculations", () => {
  it("treats unknown capacity as available for both public calculations", () => {
    expect(calculateAvailableKg(null, 5, 2)).toBeNull();
    expect(
      checkDeliveryCapacity({
        capacityKg: null,
        alreadyAppliedTons: 5,
        requestedTons: 100,
        existingApplicationTons: 2,
      }),
    ).toEqual({ ok: true, availableKg: null });
  });

  it("adds the current application back to available stock in edit mode", () => {
    expect(calculateAvailableKg(10_000, 8, 3)).toBe(5_000);
    expect(
      checkDeliveryCapacity({
        capacityKg: 10_000,
        alreadyAppliedTons: 8,
        requestedTons: 5,
        existingApplicationTons: 3,
      }),
    ).toEqual({ ok: true, availableKg: 5_000 });
  });

  it("returns the delivery overdraw message", () => {
    const result = checkDeliveryCapacity({
      capacityKg: 3_000,
      alreadyAppliedTons: 2,
      requestedTons: 1.5,
    });

    expect(result).toMatchObject({
      ok: false,
      availableKg: 1_000,
    });
    expect(result.errorMessage).toBe("Not enough biochar in this delivery");
  });
});
