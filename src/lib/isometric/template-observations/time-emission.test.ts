import { describe, expect, it } from "vitest";
import { TIME_BASED_BLUEPRINT_KEY, timeEmissionKg, timeEmissionRatePerHour } from "./time-emission";

describe("timeEmissionRatePerHour", () => {
  it("keeps a per hour rate as it is", () => {
    expect(timeEmissionRatePerHour("kgCO2e / hour", 0.41264)).toBe(0.41264);
    expect(timeEmissionRatePerHour("kg_co2e / h", "2")).toBe(2);
  });

  it("divides a per day rate by the hours in a day", () => {
    expect(timeEmissionRatePerHour("kgCO2e / day", 24)).toBe(1);
    expect(timeEmissionRatePerHour("kgCO2e / day", "12")).toBe(0.5);
  });

  it("converts the carbon unit to kilograms", () => {
    expect(timeEmissionRatePerHour("gCO2e / hour", 500)).toBe(0.5);
    expect(timeEmissionRatePerHour("tCO2e / hour", 0.002)).toBe(2);
  });

  it("returns null for a missing rate or an unknown unit", () => {
    expect(timeEmissionRatePerHour("kgCO2e / hour", null)).toBeNull();
    expect(timeEmissionRatePerHour("kgCO2e / hour", undefined)).toBeNull();
    expect(timeEmissionRatePerHour("kgCO2e / hour", "abc")).toBeNull();
    expect(timeEmissionRatePerHour("kgCO2e / furlong", 1)).toBeNull();
    expect(timeEmissionRatePerHour("kg / hour", 1)).toBeNull();
    expect(timeEmissionRatePerHour("", 1)).toBeNull();
    expect(timeEmissionRatePerHour(undefined, 1)).toBeNull();
  });
});

describe("timeEmissionKg", () => {
  it("multiplies hours by the rate", () => {
    expect(timeEmissionKg({ magnitude: "12.5", unit: "h" }, 0.41264)).toBeCloseTo(5.158, 10);
  });

  it("reads hours from other time units", () => {
    expect(timeEmissionKg({ magnitude: "2", unit: "day" }, 1)).toBe(48);
    expect(timeEmissionKg({ magnitude: "90", unit: "min" }, 2)).toBe(3);
  });

  it("returns null when the hours or their unit cannot be read", () => {
    expect(timeEmissionKg({ magnitude: "x", unit: "h" }, 1)).toBeNull();
    expect(timeEmissionKg({ magnitude: "1", unit: "kg" }, 1)).toBeNull();
    expect(timeEmissionKg({ magnitude: "1", unit: "h" }, null)).toBeNull();
  });
});

it("names the blueprint", () => {
  expect(TIME_BASED_BLUEPRINT_KEY).toBe("time_based_emissions");
});
