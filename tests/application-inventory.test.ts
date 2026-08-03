import { describe, expect, it } from "vitest";
import {
  calculateAvailableKg,
  checkDeliveryCapacity,
} from "@/lib/calculations/delivery-inventory";

describe("calculateAvailableKg", () => {
  it("returns null when capacity is null", () => {
    expect(calculateAvailableKg(null, 0)).toBeNull();
  });

  it("returns full capacity when nothing is applied", () => {
    expect(calculateAvailableKg(10000, 0)).toBe(10000);
  });

  it("subtracts already-applied tons converted to kg", () => {
    // 5 tons applied = 5000 kg used → 5000 remaining from 10000
    expect(calculateAvailableKg(10000, 5)).toBe(5000);
  });

  it("adds back the existing application tons in edit mode", () => {
    // 10000 kg capacity, 8 tons (8000 kg) total applied, 3 tons (3000 kg) is the current application
    // available = 10000 - 8000 + 3000 = 5000
    expect(calculateAvailableKg(10000, 8, 3)).toBe(5000);
  });

  it("returns zero when fully consumed", () => {
    expect(calculateAvailableKg(5000, 5)).toBe(0);
  });

  it("returns negative when over-applied (existing data)", () => {
    // e.g. a delivery was updated after applications were created
    expect(calculateAvailableKg(1000, 5)).toBe(-4000);
  });
});

describe("checkDeliveryCapacity", () => {
  it("skips the check and returns ok when capacity is null", () => {
    const result = checkDeliveryCapacity({
      capacityKg: null,
      alreadyAppliedTons: 0,
      requestedTons: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.availableKg).toBeNull();
  });

  it("approves when requested amount is within available capacity", () => {
    const result = checkDeliveryCapacity({
      capacityKg: 10000,
      alreadyAppliedTons: 0,
      requestedTons: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.availableKg).toBe(10000);
  });

  it("approves exact capacity usage", () => {
    const result = checkDeliveryCapacity({
      capacityKg: 5000,
      alreadyAppliedTons: 0,
      requestedTons: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.availableKg).toBe(5000); // available before this request
  });

  it("rejects when requested exceeds available", () => {
    const result = checkDeliveryCapacity({
      capacityKg: 1000,
      alreadyAppliedTons: 0,
      requestedTons: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.availableKg).toBe(1000);
    expect(result.errorMessage).toBe("Not enough biochar in this delivery");
  });

  it("accounts for existing application when editing (approve)", () => {
    // Delivery: 10000 kg, already 8 tons (8000 kg) total, 3 tons (3000 kg) is this application
    // Available = 10000 - 8000 + 3000 = 5000 kg
    // Requesting 4 tons (4000 kg) → ok
    const result = checkDeliveryCapacity({
      capacityKg: 10000,
      alreadyAppliedTons: 8,
      requestedTons: 4,
      existingApplicationTons: 3,
    });
    expect(result.ok).toBe(true);
    expect(result.availableKg).toBe(5000);
  });

  it("accounts for existing application when editing (reject)", () => {
    // Available = 10000 - 8000 + 3000 = 5000 kg; requesting 6 tons (6000 kg) → reject
    const result = checkDeliveryCapacity({
      capacityKg: 10000,
      alreadyAppliedTons: 8,
      requestedTons: 6,
      existingApplicationTons: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.availableKg).toBe(5000);
    expect(result.errorMessage).toBe("Not enough biochar in this delivery");
  });

  it("rejects partial capacity exceeded with partial prior applications", () => {
    // 3000 kg capacity, 2 tons (2000 kg) already used → 1000 kg left
    // requesting 1.5 tons (1500 kg) → reject
    const result = checkDeliveryCapacity({
      capacityKg: 3000,
      alreadyAppliedTons: 2,
      requestedTons: 1.5,
    });
    expect(result.ok).toBe(false);
    expect(result.availableKg).toBe(1000);
    expect(result.errorMessage).toBe("Not enough biochar in this delivery");
  });
});
