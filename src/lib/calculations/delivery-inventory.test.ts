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

  it("subtracts applied stock and preserves exhausted or overdrawn totals", () => {
    expect(calculateAvailableKg(10_000, 0)).toBe(10_000);
    expect(calculateAvailableKg(10_000, 5)).toBe(5_000);
    expect(calculateAvailableKg(5_000, 5)).toBe(0);
    expect(calculateAvailableKg(1_000, 5)).toBe(-4_000);
  });

  it("approves requests within or exactly at available capacity", () => {
    expect(
      checkDeliveryCapacity({
        capacityKg: 10_000,
        alreadyAppliedTons: 0,
        requestedTons: 5,
      }),
    ).toEqual({ ok: true, availableKg: 10_000 });
    expect(
      checkDeliveryCapacity({
        capacityKg: 5_000,
        alreadyAppliedTons: 0,
        requestedTons: 5,
      }),
    ).toEqual({ ok: true, availableKg: 5_000 });
  });

  it("adds the current application back to available stock in edit mode", () => {
    expect(calculateAvailableKg(10_000, 8, 3)).toBe(5_000);
    expect(
      checkDeliveryCapacity({
        capacityKg: 10_000,
        alreadyAppliedTons: 8,
        requestedTons: 4,
        existingApplicationTons: 3,
      }),
    ).toEqual({ ok: true, availableKg: 5_000 });
  });

  it("rejects an edit that exceeds restored stock", () => {
    expect(
      checkDeliveryCapacity({
        capacityKg: 10_000,
        alreadyAppliedTons: 8,
        requestedTons: 6,
        existingApplicationTons: 3,
      }),
    ).toMatchObject({
      ok: false,
      availableKg: 5_000,
    });
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
