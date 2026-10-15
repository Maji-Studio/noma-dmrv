import { describe, expect, it } from "vitest";
import {
  applicationSoilTemperatureSchema,
  sampleConditionSchema,
  transportLegConditionSchema,
} from "@/schemas/isometric";

describe("Isometric conditional required validation", () => {
  it("returns explicit error for distance-based transport without load mass", () => {
    const result = transportLegConditionSchema.safeParse({
      calculation_method: "distance_based",
      vehicle_type: "truck",
      distance_km: 10,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "Load mass is required"
    );
  });

  it("accepts a valid distance-based transport payload", () => {
    const result = transportLegConditionSchema.safeParse({
      calculation_method: "distance_based",
      vehicle_type: "truck",
      load_mass_kg: 7200,
      distance_km: 32,
    });

    expect(result.success).toBe(true);
  });

  it("requires soil_temperature_c on application", () => {
    const result = applicationSoilTemperatureSchema.safeParse({
      soil_temperature_source: "baseline",
      soil_temperature_c: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "Soil temperature is required for 200-year durability"
    );
  });

  it("accepts valid application soil temperature from global database", () => {
    const result = applicationSoilTemperatureSchema.safeParse({
      soil_temperature_source: "global_database",
      soil_temperature_c: 22.4,
    });

    expect(result.success).toBe(true);
  });

  it("requires nutrient declarations when nutrient claim is enabled", () => {
    const result = sampleConditionSchema.safeParse({
      nutrient_claim_enabled: true,
      phosphorus_g_per_kg: 3.2,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

});
