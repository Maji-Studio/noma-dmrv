import { describe, expect, it } from "vitest";
import { FUEL_TYPE_OPTIONS, VEHICLE_TYPE_OPTIONS, formatVehicleType, selectOptionsForStoredValue } from "./vehicles";

describe("formatVehicleType", () => {
  it("maps every stored slug to its option label", () => {
    for (const option of VEHICLE_TYPE_OPTIONS) {
      expect(formatVehicleType(option.value)).toBe(option.label);
    }
  });

  it("sentence-cases free-text values that predate the option list", () => {
    expect(formatVehicleType("articulated lorry")).toBe("Articulated lorry");
  });

  it("leaves an already-capitalised value alone", () => {
    expect(formatVehicleType("Class 8 truck")).toBe("Class 8 truck");
  });

  it("returns an empty string for blank input", () => {
    expect(formatVehicleType("   ")).toBe("");
  });
});

describe("selectOptionsForStoredValue", () => {
  it("maps a stored fuel type to its option in any case", () => {
    const field = selectOptionsForStoredValue(FUEL_TYPE_OPTIONS, "diesel", { ignoreCase: true });
    expect(field.value).toBe("Diesel");
    expect(field.options).toBe(FUEL_TYPE_OPTIONS);
  });

  it("keeps a stored value no option matches as an extra option", () => {
    const field = selectOptionsForStoredValue(FUEL_TYPE_OPTIONS, "LPG", { ignoreCase: true });
    expect(field.value).toBe("LPG");
    expect(field.options.at(-1)).toEqual({ value: "LPG", label: "LPG" });
  });

  it("keeps a vehicle type exactly as stored when only its case differs", () => {
    const field = selectOptionsForStoredValue(VEHICLE_TYPE_OPTIONS, "Truck", { ignoreCase: false });
    expect(field.value).toBe("Truck");
    expect(field.options.map((option) => option.value)).toContain("Truck");
  });

  it("leaves a blank value blank", () => {
    expect(selectOptionsForStoredValue(FUEL_TYPE_OPTIONS, null, { ignoreCase: true }).value).toBe("");
  });
});
