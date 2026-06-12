import { describe, expect, it } from "vitest";
import { resolveApplicationSoilTemperatureDefault } from "@/components/applications/mass-utils";

describe("application soil temperature defaults", () => {
  it("prefills global-database soil temperature from the delivery customer location first", () => {
    expect(
      resolveApplicationSoilTemperatureDefault({
        delivery: {
          defaultSoilTemperatureC: 21.4,
          facilityDefaultSoilTemperatureC: 24.8,
        },
      }),
    ).toEqual({
      soilTemperatureSource: "global_database",
      soilTemperatureC: 21.4,
    });
  });

  it("falls back to the facility emission config default when the location has none", () => {
    expect(
      resolveApplicationSoilTemperatureDefault({
        delivery: {
          defaultSoilTemperatureC: null,
          facilityDefaultSoilTemperatureC: 24.8,
        },
      }),
    ).toEqual({
      soilTemperatureSource: "global_database",
      soilTemperatureC: 24.8,
    });
  });

  it("leaves soil temperature empty when no default is configured", () => {
    expect(
      resolveApplicationSoilTemperatureDefault({
        delivery: {
          defaultSoilTemperatureC: null,
          facilityDefaultSoilTemperatureC: null,
        },
      }),
    ).toBeNull();
  });
});
