import { describe, expect, it } from "vitest";
import {
  reactorSamplingMethodSchema,
  creditBatchConditionSchema,
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
      "load_mass_kg is required"
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

  it("requires h_to_c_org_ratio for 200-year durability on credit batch", () => {
    const result = creditBatchConditionSchema.safeParse({
      durability_option: "200_year",
      h_to_c_org_ratio: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "h_to_c_org_ratio is required when durability_option=200_year"
    );
  });

  it("requires soil_temperature_c on application", () => {
    const result = applicationSoilTemperatureSchema.safeParse({
      soil_temperature_source: "baseline",
      soil_temperature_c: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "soil_temperature_c is required for 200-year durability calculation"
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

  it("requires reactor_id when selecting sampling method on reactor", () => {
    const result = reactorSamplingMethodSchema.safeParse({
      sampling_method: "method_b",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "reactor_id"
    );
  });

  it("accepts Method A for a reactor", () => {
    const result = reactorSamplingMethodSchema.safeParse({
      reactor_id: "00000000-0000-0000-0000-000000000101",
      sampling_method: "method_a",
    });

    expect(result.success).toBe(true);
  });

  it("accepts Method B when prior Method A samples meet threshold", () => {
    const result = reactorSamplingMethodSchema.safeParse({
      sampling_method: "method_b",
      reactor_id: "00000000-0000-0000-0000-000000000101",
      prior_method_a_sample_count: 30,
    });

    expect(result.success).toBe(true);
  });

  it("rejects Method B when prior Method A samples are below threshold", () => {
    const result = reactorSamplingMethodSchema.safeParse({
      sampling_method: "method_b",
      reactor_id: "00000000-0000-0000-0000-000000000101",
      prior_method_a_sample_count: 29,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "sampling_method=method_b requires at least 30 prior samples under Method A"
    );
  });

});
