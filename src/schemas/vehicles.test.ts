import { describe, expect, it } from "vitest";
import { VEHICLE_TYPE_OPTIONS, formatVehicleType } from "./vehicles";

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
