import { describe, expect, it } from "vitest";
import {
  creditBatchSamplingMethodSchema,
  continuousGasMeasurementSchema,
  creditBatchConditionSchema,
  sampleConditionSchema,
  transportLegConditionSchema,
} from "@/schemas/isometric";

describe("Isometric conditional required validation", () => {
  it("returns explicit error for distance-based transport without load mass", () => {
    const result = transportLegConditionSchema.safeParse({
      calculation_method: "distance_based",
      vehicle_type: "truck",
      distance_km: 10,
      emission_factor_used: 0.12,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "load_mass_kg is required when calculation_method=distance_based"
    );
  });

  it("accepts valid energy usage transport payload", () => {
    const result = transportLegConditionSchema.safeParse({
      calculation_method: "energy_usage",
      fuel_type: "diesel",
      fuel_consumed_liters: 14.5,
      distance_km: 32,
      emission_factor_used: 2.68,
    });

    expect(result.success).toBe(true);
  });

  it("requires 200-year durability inputs when selected", () => {
    const result = creditBatchConditionSchema.safeParse({
      durability_option: "200_year",
      sampling_method: "method_a",
      soil_temperature_c: null,
      h_to_c_org_ratio: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "soil_temperature_c is required when durability_option=200_year",
        "h_to_c_org_ratio is required when durability_option=200_year",
      ])
    );
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

  it("requires ppm fields for continuous gas measurement pathway", () => {
    const result = continuousGasMeasurementSchema.safeParse({
      continuous_gas_measurement: true,
      ch4_ppm: 12,
      n2o_ppm: 2,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "co_ppm is required when continuous_gas_measurement=true",
        "co2_ppm is required when continuous_gas_measurement=true",
      ])
    );
  });

  it("requires reactor_id when Method B sampling is selected", () => {
    const result = creditBatchSamplingMethodSchema.safeParse({
      sampling_method: "method_b",
      reporting_period_start: "2026-01-01",
      reporting_period_end: "2026-01-31",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "reactor_id is required when sampling_method=method_b"
    );
  });

  it("rejects Method B when prior Method A samples are below threshold", () => {
    const result = creditBatchSamplingMethodSchema.safeParse({
      sampling_method: "method_b",
      reactor_id: "00000000-0000-0000-0000-000000000101",
      reporting_period_start: "2026-01-01",
      reporting_period_end: "2026-01-31",
      prior_method_a_sample_count: 29,
      reporting_period_run_count: 10,
      reporting_period_sampled_run_count: 1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "sampling_method=method_b requires at least 30 prior samples under Method A"
    );
  });

  it("rejects Method B when reporting-period cadence is below 1-in-10", () => {
    const result = creditBatchSamplingMethodSchema.safeParse({
      sampling_method: "method_b",
      reactor_id: "00000000-0000-0000-0000-000000000101",
      reporting_period_start: "2026-01-01",
      reporting_period_end: "2026-01-31",
      prior_method_a_sample_count: 30,
      reporting_period_run_count: 11,
      reporting_period_sampled_run_count: 1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "sampling_method=method_b requires at least 1 sampled production run per 10 runs in the reporting period"
    );
  });
});
