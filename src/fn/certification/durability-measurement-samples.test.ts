import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { FacilityReferenceSoilTemperature } from "@/lib/isometric/utils/durability-aggregation";
import {
  buildDurabilityMeasurementSampleSubmissions,
  DURABILITY_MEASUREMENT_SAMPLES_LIVE,
} from "./durability-measurement-samples";

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
    productionProcessId: "pp_1",
    samplingMethod: "method_a",
    declaredHToCorgRatio: null,
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

  it("skips an unsampled batch's production-batch sample but still emits the soil one", () => {
    const submissions = buildDurabilityMeasurementSampleSubmissions({
      ...common,
      batches: [batch({ creditBatchId: "u", creditBatchCode: "CB-U" })],
    });

    expect(submissions.map((s) => s.operationKey)).toEqual(["soil"]);
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
