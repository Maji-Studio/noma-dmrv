import { describe, expect, it } from "vitest";
import type {
  ConservativeSoilTemperature,
  PerBatchDurabilityDatapoint,
} from "../utils/durability-aggregation";
import {
  buildBiocharProductionBatchSample,
  buildBiocharSoilSample,
  H_C_MOLAR_RATIO_PERCENT_SCALE,
  H_TO_C_ORG_MEASUREMENT_PROPERTY,
  SEQUESTRATION_BLUEPRINT_SAMPLED,
  SEQUESTRATION_BLUEPRINT_UNSAMPLED,
  SOIL_TEMPERATURE_MEASUREMENT_PROPERTY,
  selectSequestrationBlueprintKey,
  toHcMolarRatioPercent,
} from "./measurement-sample";

function batch(
  overrides: Partial<PerBatchDurabilityDatapoint>,
): PerBatchDurabilityDatapoint {
  return {
    productionRunId: "run-1",
    productionRunCode: "PR-1",
    sampled: true,
    replicateCount: 3,
    hToCorgRatio: { mean: 0.3, stdDev: 0.02 },
    totalCarbonPercent: { mean: 82, stdDev: 1 },
    inorganicCarbonPercent: { mean: 1, stdDev: 0.1 },
    productMassKg: 1000,
    ...overrides,
  };
}

describe("measurement-property + blueprint constants (coverage-check, plan §4)", () => {
  it("pins the confirmed H/C and soil-temp measurement properties", () => {
    expect(H_TO_C_ORG_MEASUREMENT_PROPERTY).toEqual({
      quantity_kind: "dimensionless_ratio",
      qualifier: "hydrogen_to_organic_carbon_ratio",
    });
    expect(SOIL_TEMPERATURE_MEASUREMENT_PROPERTY).toEqual({
      quantity_kind: "temperature",
      qualifier: null,
    });
  });

  it("pins the two sequestration blueprint keys", () => {
    expect(SEQUESTRATION_BLUEPRINT_SAMPLED).toBe(
      "biochar_sequestration_200_year_c_org",
    );
    expect(SEQUESTRATION_BLUEPRINT_UNSAMPLED).toBe(
      "biochar_sequestration_200_year_unsampled",
    );
  });
});

describe("selectSequestrationBlueprintKey (D6 — blueprint IS the A/B distinction)", () => {
  it("routes a sampled batch to the c_org blueprint", () => {
    expect(
      selectSequestrationBlueprintKey({ sampled: true, samplingMethod: "method_a" }),
    ).toBe(SEQUESTRATION_BLUEPRINT_SAMPLED);
    expect(
      selectSequestrationBlueprintKey({ sampled: true, samplingMethod: "method_b" }),
    ).toBe(SEQUESTRATION_BLUEPRINT_SAMPLED);
  });

  it("routes an unsampled (Method B) batch to the unsampled blueprint", () => {
    expect(
      selectSequestrationBlueprintKey({ sampled: false, samplingMethod: "method_b" }),
    ).toBe(SEQUESTRATION_BLUEPRINT_UNSAMPLED);
  });

  it("fails closed on the impossible unsampled + Method A combination", () => {
    expect(() =>
      selectSequestrationBlueprintKey({ sampled: false, samplingMethod: "method_a" }),
    ).toThrow(/method b/i);
  });
});

describe("toHcMolarRatioPercent (⚠️ sandbox-gated ×100 transform)", () => {
  it("scales the dimensionless ratio by the percent scale", () => {
    expect(H_C_MOLAR_RATIO_PERCENT_SCALE).toBe(100);
    expect(toHcMolarRatioPercent(0.3)).toBeCloseTo(30, 5);
  });
});

describe("buildBiocharProductionBatchSample", () => {
  it("builds a biochar_production_batch sample with the H/C value (magnitude + std-dev scaled, unit %)", () => {
    const sample = buildBiocharProductionBatchSample({
      batch: batch({}),
      projectId: "prj_1",
      supplierRefId: "nm-mts-abc-pb-def-v1",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    expect(sample).not.toBeNull();
    expect(sample!.measurement_type).toBe("biochar_production_batch");
    expect(sample!.project_id).toBe("prj_1");
    expect(sample!.supplier_reference_id).toBe("nm-mts-abc-pb-def-v1");
    expect(sample!.values).toHaveLength(1);
    const value = sample!.values[0];
    expect(value.measurement_property).toEqual(H_TO_C_ORG_MEASUREMENT_PROPERTY);
    expect(value.value.magnitude).toBeCloseTo(30, 5); // 0.3 × 100
    expect(value.value.standard_deviation).toBeCloseTo(2, 5); // 0.02 × 100
    expect(value.value.unit).toBe("%");
  });

  it("passes through the production batch id when supplied", () => {
    const sample = buildBiocharProductionBatchSample({
      batch: batch({}),
      projectId: "prj_1",
      supplierRefId: "ref",
      measuredAt: "2026-01-31T00:00:00Z",
      productionBatchId: "pbt_123",
    });
    expect(sample!.production_batch_id).toBe("pbt_123");
  });

  it("returns null for an unsampled batch (no chemistry to group)", () => {
    const sample = buildBiocharProductionBatchSample({
      batch: batch({ sampled: false, hToCorgRatio: null }),
      projectId: "prj_1",
      supplierRefId: "ref",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    expect(sample).toBeNull();
  });

  it("emits a null std-dev when the batch has a single replicate", () => {
    const sample = buildBiocharProductionBatchSample({
      batch: batch({ hToCorgRatio: { mean: 0.3, stdDev: null } }),
      projectId: "prj_1",
      supplierRefId: "ref",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    expect(sample!.values[0].value.standard_deviation).toBeNull();
  });
});

describe("buildBiocharSoilSample", () => {
  const soilTemp: ConservativeSoilTemperature = {
    effectiveSoilTemperatureC: 18.4,
    maxSoilTemperatureC: 18.4,
    temperatureFloored: false,
    spreadC: 2,
    subdivideWarning: true,
    conservativeEstimate: true,
    method: "Conservative estimate: maximum soil temperature across 2 sites.",
    warnings: [],
  };

  it("builds a biochar_soil sample with the conservative temperature (degC)", () => {
    const sample = buildBiocharSoilSample({
      soilTemp,
      projectId: "prj_1",
      supplierRefId: "nm-mts-abc-soil-v1",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    expect(sample).not.toBeNull();
    expect(sample!.measurement_type).toBe("biochar_soil");
    expect(sample!.values[0].measurement_property).toEqual(
      SOIL_TEMPERATURE_MEASUREMENT_PROPERTY,
    );
    expect(sample!.values[0].value.magnitude).toBe(18.4);
    expect(sample!.values[0].value.unit).toBe("degC");
  });

  it("returns null when the conservative estimate is indeterminate", () => {
    const sample = buildBiocharSoilSample({
      soilTemp: { ...soilTemp, effectiveSoilTemperatureC: null },
      projectId: "prj_1",
      supplierRefId: "ref",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    expect(sample).toBeNull();
  });
});
