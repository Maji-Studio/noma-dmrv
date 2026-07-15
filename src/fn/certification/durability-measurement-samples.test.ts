import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { FacilityReferenceSoilTemperature } from "@/lib/isometric/utils/durability-aggregation";
import {
  buildDurabilityMeasurementSampleSubmissions,
  DURABILITY_MEASUREMENT_SAMPLES_LIVE,
} from "./durability-measurement-samples";
import { normalizeMeasurementSamplesForHash } from "./durability-measurement-sample-snapshot";

function sample(overrides: Partial<Sample>): Sample {
  return {
    hToCOrgRatio: null,
    oToCOrgRatio: null,
    totalCarbonPercent: null,
    organicCarbonPercent: null,
    inorganicCarbonPercent: null,
    ...overrides,
  } as unknown as Sample;
}

function batch(
  overrides: Partial<CreditBatchWithSamples> &
    Pick<CreditBatchWithSamples, "creditBatchId" | "creditBatchCode">,
): CreditBatchWithSamples {
  return {
    samples: [],
    runs: [],
    facilityTimezone: "UTC",
    productionProcessId: "pp_1",
    samplingMethod: "method_a",
    declaredHToCorgRatio: null,
    durabilityOption: "200_year",
    ...overrides,
  };
}

const SOIL: FacilityReferenceSoilTemperature = {
  declaredSoilTemperatureC: 12.5,
  effectiveSoilTemperatureC: 12.5,
  source: "Lembrechts 2022",
  temperatureFloored: false,
  method: "Facility reference soil temperature (annual average; 7 °C floor)",
  warnings: [],
};

const sampledBatch = (id: string, code: string) =>
  batch({
    creditBatchId: id,
    creditBatchCode: code,
    runs: [{ id: `run-${id}`, code: `R-${id}`, biocharDryMassKg: 1000 }],
    samples: [
      sample({ hToCOrgRatio: 0.28, totalCarbonPercent: 80, organicCarbonPercent: 79 }),
      sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 82, organicCarbonPercent: 81 }),
      sample({ hToCOrgRatio: 0.32, totalCarbonPercent: 84, organicCarbonPercent: 83 }),
    ],
  });

describe("DURABILITY_MEASUREMENT_SAMPLES_LIVE", () => {
  it("stays off until the two sandbox confirms land", () => {
    expect(DURABILITY_MEASUREMENT_SAMPLES_LIVE).toBe(false);
  });
});

describe("buildDurabilityMeasurementSampleSubmissions", () => {
  const common = {
    removalId: "rem-1",
    version: 2,
    externalProjectId: "prj_X",
    attributionByRunId: new Map<string, number>(),
    facilityReferenceSoilTemperature: SOIL,
    measuredAt: "2026-01-31T00:00:00.000Z",
  };

  it("emits one production-batch submission per sampled batch, then one soil submission", () => {
    const submissions = buildDurabilityMeasurementSampleSubmissions({
      ...common,
      batches: [sampledBatch("a", "CB-A"), sampledBatch("b", "CB-B")],
    });

    expect(submissions).toHaveLength(3);
    expect(submissions.map((s) => s.operationKey)).toEqual([
      "pb:a",
      "pb:b",
      "soil",
    ]);

    for (const pb of submissions.slice(0, 2)) {
      expect(pb.supplierRefId).toMatch(/^nm-mts-.*-pb-.*-v2$/);
      expect(pb.body.supplier_reference_id).toBe(pb.supplierRefId);
      expect(pb.body.measurement_type).toBe("biochar_production_batch");
      expect(pb.body.project_id).toBe("prj_X");
      expect(pb.body.measured_at).toBe("2026-01-31T00:00:00.000Z");
    }

    const soil = submissions[2];
    expect(soil.supplierRefId).toMatch(/^nm-mts-.*-soil-v2$/);
    expect(soil.body.measurement_type).toBe("biochar_soil");
    expect(soil.body.values[0].value.magnitude).toBe(12.5);
    expect(soil.body.values[0].value.unit).toBe("degC");
  });

  it("routes an unsampled Method-B batch to the _unsampled blueprint (mass-only), then soil", () => {
    const submissions = buildDurabilityMeasurementSampleSubmissions({
      ...common,
      batches: [
        batch({
          creditBatchId: "u",
          creditBatchCode: "CB-U",
          samplingMethod: "method_b",
          runs: [{ id: "run-u", code: "R-U", biocharDryMassKg: 1000 }],
        }),
      ],
    });

    expect(submissions.map((s) => s.operationKey)).toEqual([
      "pb-unsampled:u",
      "soil",
    ]);
    const pb = submissions[0];
    expect(pb.body.measurement_type).toBe("biochar_production_batch");
    // Mass-only — the registry derives carbon + durable fraction from history.
    expect(pb.body.values).toHaveLength(1);
    expect(pb.body.values[0].measurement_property.quantity_kind).toBe("mass");
    expect(pb.body.values[0].value.magnitude).toBe(1000);
  });

  it("throws on an unsampled Method-A batch (impossible state — fail closed)", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        batches: [
          batch({
            creditBatchId: "x",
            creditBatchCode: "CB-X",
            samplingMethod: "method_a",
          }),
        ],
      }),
    ).toThrow(/only valid under Method B/);
  });

  it("emits the full per-replicate 1000-year payload without a soil sample", () => {
    const thousandYearBatch = batch({
      creditBatchId: "t",
      creditBatchCode: "CB-T",
      durabilityOption: "1000_year",
      runs: [{ id: "run-t", code: "R-T", biocharDryMassKg: 1000 }],
      samples: [
        sample({ totalCarbonPercent: 80, sReflectanceFraction: 0.91 }),
        sample({ totalCarbonPercent: 82, sReflectanceFraction: 0.92 }),
        sample({ totalCarbonPercent: 84, sReflectanceFraction: 0.93 }),
      ],
    });

    const submissions = buildDurabilityMeasurementSampleSubmissions({
      ...common,
      facilityReferenceSoilTemperature: null,
      batches: [thousandYearBatch],
    });

    expect(submissions).toHaveLength(1);
    expect(submissions[0].operationKey).toBe("pb:t");
    expect(submissions[0].body.measurement_type).toBe(
      "biochar_production_batch",
    );
    expect(
      submissions[0].body.values.map((value) => ({
        qualifier: value.measurement_property.qualifier,
        magnitude: value.value.magnitude,
        unit: value.value.unit,
      })),
    ).toEqual([
      { qualifier: "total_carbon", magnitude: 0.8, unit: "dimensionless" },
      { qualifier: "inertinite_fraction", magnitude: 0.91, unit: "dimensionless" },
      { qualifier: "total_carbon", magnitude: 0.82, unit: "dimensionless" },
      { qualifier: "inertinite_fraction", magnitude: 0.92, unit: "dimensionless" },
      { qualifier: "total_carbon", magnitude: 0.84, unit: "dimensionless" },
      { qualifier: "inertinite_fraction", magnitude: 0.93, unit: "dimensionless" },
      { qualifier: null, magnitude: 1000, unit: "kg" },
    ]);
  });

  it("normalizes to an identical hash payload regardless of sample row order", () => {
    // Postgres guarantees no row order without an ORDER BY, and replicate
    // order flows into the body's `values` list — a reorder of unchanged rows
    // must NOT flip the semantic change-detection hash.
    const orderedSamples = [
      sample({ id: "smp-1", totalCarbonPercent: 80, sReflectanceFraction: 0.91 }),
      sample({ id: "smp-2", totalCarbonPercent: 82, sReflectanceFraction: 0.92 }),
      sample({ id: "smp-3", totalCarbonPercent: 84, sReflectanceFraction: 0.93 }),
    ];
    const buildNormalized = (samples: Sample[]) =>
      normalizeMeasurementSamplesForHash(
        buildDurabilityMeasurementSampleSubmissions({
          ...common,
          facilityReferenceSoilTemperature: null,
          batches: [
            batch({
              creditBatchId: "t",
              creditBatchCode: "CB-T",
              durabilityOption: "1000_year",
              runs: [{ id: "run-t", code: "R-T", biocharDryMassKg: 1000 }],
              samples,
            }),
          ],
        }),
      );

    const forward = buildNormalized(orderedSamples);
    const reversed = buildNormalized([...orderedSamples].reverse());

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("fails closed when a 1000-year batch has fewer than three complete replicates", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        facilityReferenceSoilTemperature: null,
        batches: [
          batch({
            creditBatchId: "t-short",
            creditBatchCode: "CB-T-SHORT",
            durabilityOption: "1000_year",
            runs: [{ id: "run-t", code: "R-T", biocharDryMassKg: 1000 }],
            samples: [
              sample({ totalCarbonPercent: 80, sReflectanceFraction: 0.91 }),
              sample({ totalCarbonPercent: 82, sReflectanceFraction: 0.92 }),
            ],
          }),
        ],
      }),
    ).toThrow(/2 complete 1000-year replicate/);
  });

  it("fails closed instead of silently dropping an incomplete 1000-year sample", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        facilityReferenceSoilTemperature: null,
        batches: [
          batch({
            creditBatchId: "t-partial",
            creditBatchCode: "CB-T-PARTIAL",
            durabilityOption: "1000_year",
            runs: [{ id: "run-t", code: "R-T", biocharDryMassKg: 1000 }],
            samples: [
              sample({ totalCarbonPercent: 80, sReflectanceFraction: 0.91 }),
              sample({ totalCarbonPercent: 82, sReflectanceFraction: 0.92 }),
              sample({ totalCarbonPercent: 84, sReflectanceFraction: null }),
            ],
          }),
        ],
      }),
    ).toThrow(/1 sample.*missing total carbon or the R₀/);
  });

  it("still fails closed when a 200-year batch has no soil reference", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        facilityReferenceSoilTemperature: null,
        batches: [sampledBatch("a", "CB-A")],
      }),
    ).toThrow(/soil temperature is required for 200-year/);
  });

  it("scales product mass by the per-run applied attribution", () => {
    const [pb] = buildDurabilityMeasurementSampleSubmissions({
      ...common,
      batches: [sampledBatch("a", "CB-A")],
      attributionByRunId: new Map([["run-a", 0.5]]),
    });

    const massValue = pb.body.values.find(
      (v) => v.measurement_property.quantity_kind === "mass",
    );
    expect(massValue?.value.magnitude).toBe(500); // 1000 kg × 0.5
  });
});
