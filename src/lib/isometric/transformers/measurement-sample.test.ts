import { describe, expect, it } from "vitest";
import type {
  FacilityReferenceSoilTemperature,
  PerBatchDurabilityDatapoint,
} from "../utils/durability-aggregation";
import {
  build1000YearSequestrationSample,
  buildBiocharProductionBatchSample,
  buildBiocharSoilSample,
  CARBON_CONTENT_UNIT,
  CARBON_CONTENTS_MEASUREMENT_PROPERTY,
  CARBON_CONTENTS_UNIT,
  expectedSequestrationBlueprintKeys,
  H_C_MOLAR_RATIO_PERCENT_SCALE,
  H_TO_C_ORG_MEASUREMENT_PROPERTY,
  INORGANIC_CARBON_MEASUREMENT_PROPERTY,
  isSequestrationBlueprintFamily,
  isSequestrationBlueprintKey,
  PRODUCT_MASS_MEASUREMENT_PROPERTY,
  PRODUCT_MASS_UNIT,
  S_FRACTION_MEASUREMENT_PROPERTY,
  S_FRACTION_UNIT,
  SEQUESTRATION_BLUEPRINT_1000_YEAR,
  SEQUESTRATION_BLUEPRINT_SAMPLED,
  SEQUESTRATION_BLUEPRINT_UNSAMPLED,
  SOIL_TEMPERATURE_MEASUREMENT_PROPERTY,
  selectSequestrationBlueprintKey,
  toCarbonContentFraction,
  TOTAL_CARBON_MEASUREMENT_PROPERTY,
  toHcMolarRatioPercent,
} from "./measurement-sample";

function batch(
  overrides: Partial<PerBatchDurabilityDatapoint>,
): PerBatchDurabilityDatapoint {
  return {
    creditBatchId: "batch-1",
    creditBatchCode: "CB-1",
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
  it("builds a biochar_production_batch sample with H/C + carbon + product mass values", () => {
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
    // H/C, total carbon, inorganic carbon, product mass.
    expect(sample!.values).toHaveLength(4);

    const hc = sample!.values[0];
    expect(hc.measurement_property).toEqual(H_TO_C_ORG_MEASUREMENT_PROPERTY);
    expect(hc.value.magnitude).toBeCloseTo(30, 5); // 0.3 × 100
    expect(hc.value.standard_deviation).toBeCloseTo(2, 5); // 0.02 × 100
    expect(hc.value.unit).toBe("%");

    const totalC = sample!.values[1];
    expect(totalC.measurement_property).toEqual(
      TOTAL_CARBON_MEASUREMENT_PROPERTY,
    );
    expect(totalC.value.magnitude).toBeCloseTo(0.82, 5); // 82 / 100
    expect(totalC.value.standard_deviation).toBeCloseTo(0.01, 5); // 1 / 100
    expect(totalC.value.unit).toBe(CARBON_CONTENT_UNIT);

    const inorganicC = sample!.values[2];
    expect(inorganicC.measurement_property).toEqual(
      INORGANIC_CARBON_MEASUREMENT_PROPERTY,
    );
    expect(inorganicC.value.magnitude).toBeCloseTo(0.01, 5); // 1 / 100

    const mass = sample!.values[3];
    expect(mass.measurement_property).toEqual(PRODUCT_MASS_MEASUREMENT_PROPERTY);
    expect(mass.value.magnitude).toBe(1000);
    expect(mass.value.standard_deviation).toBeNull();
    expect(mass.value.unit).toBe(PRODUCT_MASS_UNIT);
  });

  it("omits carbon values the batch has no replicate for (product mass still emitted)", () => {
    const sample = buildBiocharProductionBatchSample({
      batch: batch({ totalCarbonPercent: null, inorganicCarbonPercent: null }),
      projectId: "prj_1",
      supplierRefId: "ref",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    // H/C + product mass only.
    expect(sample!.values).toHaveLength(2);
    expect(sample!.values[0].measurement_property).toEqual(
      H_TO_C_ORG_MEASUREMENT_PROPERTY,
    );
    expect(sample!.values[1].measurement_property).toEqual(
      PRODUCT_MASS_MEASUREMENT_PROPERTY,
    );
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

describe("buildBiocharSoilSample (facility reference, Phase 2 / ADR 0013)", () => {
  const soilTemp: FacilityReferenceSoilTemperature = {
    declaredSoilTemperatureC: 18.4,
    effectiveSoilTemperatureC: 18.4,
    source: "Lembrechts 2022 (region X)",
    temperatureFloored: false,
    method: "Facility reference soil temperature (annual average; 7 °C floor)",
    warnings: [],
  };

  it("builds a biochar_soil sample with the facility reference temperature (degC)", () => {
    const sample = buildBiocharSoilSample({
      soilTemp,
      projectId: "prj_1",
      supplierRefId: "nm-mts-abc-soil-v1",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    expect(sample.measurement_type).toBe("biochar_soil");
    expect(sample.supplier_reference_id).toBe("nm-mts-abc-soil-v1");
    expect(sample.values).toHaveLength(1);
    expect(sample.values[0].measurement_property).toEqual(
      SOIL_TEMPERATURE_MEASUREMENT_PROPERTY,
    );
    expect(sample.values[0].value.magnitude).toBe(18.4);
    expect(sample.values[0].value.standard_deviation).toBeNull();
    expect(sample.values[0].value.unit).toBe("degC");
  });

  it("submits the 7 °C-floored effective value, not the declared one", () => {
    const sample = buildBiocharSoilSample({
      soilTemp: {
        ...soilTemp,
        declaredSoilTemperatureC: 4.2,
        effectiveSoilTemperatureC: 7,
        temperatureFloored: true,
      },
      projectId: "prj_1",
      supplierRefId: "ref",
      measuredAt: "2026-01-31T00:00:00Z",
    });
    expect(sample.values[0].value.magnitude).toBe(7);
  });
});

describe("isSequestrationBlueprintKey + carbon scale", () => {
  it("identifies the three sequestration blueprint keys", () => {
    expect(isSequestrationBlueprintKey(SEQUESTRATION_BLUEPRINT_SAMPLED)).toBe(
      true,
    );
    expect(isSequestrationBlueprintKey(SEQUESTRATION_BLUEPRINT_UNSAMPLED)).toBe(
      true,
    );
    expect(isSequestrationBlueprintKey(SEQUESTRATION_BLUEPRINT_1000_YEAR)).toBe(
      true,
    );
    expect(isSequestrationBlueprintKey("carbon_rich_substance_sequestration")).toBe(
      false,
    );
  });

  it("scales carbon percent to a 0–1 fraction (legacy /100)", () => {
    expect(toCarbonContentFraction(82)).toBeCloseTo(0.82, 5);
  });
});

describe("isSequestrationBlueprintFamily (prefix — catches unknown variants)", () => {
  it("matches every biochar_sequestration_* key, known or not", () => {
    expect(isSequestrationBlueprintFamily(SEQUESTRATION_BLUEPRINT_SAMPLED)).toBe(
      true,
    );
    expect(isSequestrationBlueprintFamily(SEQUESTRATION_BLUEPRINT_1000_YEAR)).toBe(
      true,
    );
    // A future variant we don't yet carry inputs for is still recognised, so the
    // datapoint loop skips it and the tier guard fails closed on it.
    expect(
      isSequestrationBlueprintFamily("biochar_sequestration_500_year"),
    ).toBe(true);
    expect(isSequestrationBlueprintFamily("biochar_soil")).toBe(false);
  });
});

describe("expectedSequestrationBlueprintKeys (tier → template blueprint, ADR 0021)", () => {
  it("maps 1000-year to the single 1000-year blueprint", () => {
    const keys = expectedSequestrationBlueprintKeys("1000_year");
    expect([...keys]).toEqual([SEQUESTRATION_BLUEPRINT_1000_YEAR]);
  });

  it("maps 200-year to the sampled + Method-B unsampled blueprints", () => {
    const keys = expectedSequestrationBlueprintKeys("200_year");
    expect(keys.has(SEQUESTRATION_BLUEPRINT_SAMPLED)).toBe(true);
    expect(keys.has(SEQUESTRATION_BLUEPRINT_UNSAMPLED)).toBe(true);
    expect(keys.has(SEQUESTRATION_BLUEPRINT_1000_YEAR)).toBe(false);
  });
});

describe("build1000YearSequestrationSample (⚠️ sandbox-gated blueprint, ADR 0021)", () => {
  const baseArgs = {
    projectId: "prj_1",
    supplierRefId: "ref-1000-v1",
    measuredAt: "2026-05-31T00:00:00.000Z",
  };

  it("submits per-replicate carbon_contents + s_fraction LISTS and one product_mass SCALAR", () => {
    const sample = build1000YearSequestrationSample({
      ...baseArgs,
      productMassKg: 8000,
      replicates: [
        { carbonContentFraction: 0.792, sFraction: 0.92 },
        { carbonContentFraction: 0.778, sFraction: 0.9 },
        { carbonContentFraction: 0.804, sFraction: 0.93 },
      ],
    });
    expect(sample).not.toBeNull();
    if (!sample) return;

    // Two list values per replicate (carbon + s_fraction) + one product mass.
    const carbon = sample.values.filter(
      (v) =>
        v.measurement_property.qualifier ===
        CARBON_CONTENTS_MEASUREMENT_PROPERTY.qualifier,
    );
    const sFraction = sample.values.filter(
      (v) =>
        v.measurement_property.qualifier ===
        S_FRACTION_MEASUREMENT_PROPERTY.qualifier,
    );
    const mass = sample.values.filter(
      (v) => v.measurement_property.qualifier === null,
    );

    expect(carbon).toHaveLength(3);
    expect(sFraction).toHaveLength(3);
    expect(mass).toHaveLength(1);
    // Per-replicate values are submitted RAW — the registry computes the
    // −binomial-SE durable fraction from the full list (no local reduction).
    expect(sFraction.map((v) => v.value.magnitude)).toEqual([0.92, 0.9, 0.93]);
    expect(sFraction[0].measurement_property).toEqual({
      quantity_kind: "dimensionless_ratio",
      qualifier: "inertinite_fraction",
    });
    expect(carbon[0].value.unit).toBe(CARBON_CONTENTS_UNIT);
    expect(sFraction[0].value.unit).toBe(S_FRACTION_UNIT);
    expect(mass[0].value.magnitude).toBe(8000);
    expect(mass[0].value.unit).toBe(PRODUCT_MASS_UNIT);
    expect(sample.measurement_type).toBe("biochar_production_batch");
  });

  it("returns null when the batch pooled no replicate", () => {
    expect(
      build1000YearSequestrationSample({
        ...baseArgs,
        productMassKg: 8000,
        replicates: [],
      }),
    ).toBeNull();
  });
});
