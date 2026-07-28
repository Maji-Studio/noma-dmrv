import { describe, expect, it, vi } from "vitest";
import type { Sample } from "@/db/schema";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { FacilityReferenceSoilTemperature } from "@/lib/isometric/utils/durability-aggregation";
import {
  buildDurabilityMeasurementSampleSubmissions,
  DURABILITY_MEASUREMENT_SAMPLES_ENABLED,
  patchMeasurementSampleSourceBindings,
} from "./durability-measurement-samples";
import { normalizeMeasurementSamplesForHash } from "./durability-measurement-sample-snapshot";
import { encodeMeasurementProperty } from "@/lib/isometric/utils/measurement-property";
import { PRODUCT_MASS_MEASUREMENT_PROPERTY } from "@/lib/isometric/transformers/measurement-sample";

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
    sampling: "sampled",
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

const thousandYearBatch = (id: string, code: string) =>
  batch({
    creditBatchId: id,
    creditBatchCode: code,
    durabilityOption: "1000_year",
    runs: [{ id: `run-${id}`, code: `R-${id}`, biocharDryMassKg: 1000 }],
    samples: [
      sample({ totalCarbonPercent: 80, sReflectanceFraction: 0.91 }),
      sample({ totalCarbonPercent: 82, sReflectanceFraction: 0.92 }),
      sample({ totalCarbonPercent: 84, sReflectanceFraction: 0.93 }),
    ],
  });

describe("DURABILITY_MEASUREMENT_SAMPLES_ENABLED", () => {
  // Targeting the Isometric sandbox IS the opt-in — there is no separate flag.
  // The test env has no ISOMETRIC_ENVIRONMENT, which defaults to "sandbox".
  it("is on whenever the environment targets the sandbox", () => {
    expect(DURABILITY_MEASUREMENT_SAMPLES_ENABLED).toBe(true);
  });

  it("is off whenever the environment targets production", async () => {
    const { env: currentEnv } = await import("@/config/env");
    vi.resetModules();
    vi.doMock("@/config/env", () => ({
      env: { ...currentEnv, ISOMETRIC_ENVIRONMENT: "production" },
    }));

    try {
      const productionModule = await import("./durability-measurement-samples");
      expect(
        productionModule.DURABILITY_MEASUREMENT_SAMPLES_ENABLED,
      ).toBe(false);
    } finally {
      vi.doUnmock("@/config/env");
      vi.resetModules();
    }
  });
});

describe("patchMeasurementSampleSourceBindings", () => {
  it("patches only product_mass response Datapoints with Inventory Sources", async () => {
    const patch = vi.fn().mockResolvedValue({
      id: "datapoint-product-mass",
      source_ids: ["source-inventory"],
    });
    const productMassProperty = encodeMeasurementProperty(
      PRODUCT_MASS_MEASUREMENT_PROPERTY,
    );

    await expect(
      patchMeasurementSampleSourceBindings({
        client: { patch } as never,
        captures: [
          {
            measurementSampleId: "measurement-sample-1",
            supplierReferenceId: "sample-ref-1",
            creditBatchId: "credit-batch-1",
            datapointIdsByMeasurementProperty: new Map([
              [productMassProperty, ["datapoint-product-mass"]],
              ["mass_fraction_dry_basis::total_carbon", ["datapoint-carbon"]],
            ]),
          },
        ],
        sourceBindingPlan: [
          {
            documentId: "document-inventory",
            sourceId: "source-inventory",
            nomaRole: "inventory",
            lineage: {
              entityType: "application",
              entityId: "application-1",
              entityLabel: "Application APP-001",
            },
            intendedTarget: {
              kind: "sequestration",
              groupKey: "co2-stored",
              componentId: "component-sequestration",
              componentBlueprintKey: "biochar_sequestration_1000_year",
              inputKey: "product_mass",
              creditBatchIds: ["credit-batch-1"],
            },
            mappingRevision: "revision-1",
          },
        ],
      }),
    ).resolves.toBe(1);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      "/datapoints/datapoint-product-mass",
      expect.objectContaining({ source_ids: ["source-inventory"] }),
    );
  });

  it("keeps Inventory Sources scoped to each credit batch's product_mass Datapoint", async () => {
    const patch = vi.fn(async (path: string, body: { source_ids: string[] }) => ({
      id: path.split("/").at(-1),
      source_ids: body.source_ids,
    }));
    const productMassProperty = encodeMeasurementProperty(
      PRODUCT_MASS_MEASUREMENT_PROPERTY,
    );

    await expect(
      patchMeasurementSampleSourceBindings({
        client: { patch } as never,
        captures: [
          {
            measurementSampleId: "measurement-sample-a",
            supplierReferenceId: "sample-ref-a",
            creditBatchId: "credit-batch-a",
            datapointIdsByMeasurementProperty: new Map([
              [productMassProperty, ["datapoint-product-mass-a"]],
            ]),
          },
          {
            measurementSampleId: "measurement-sample-b",
            supplierReferenceId: "sample-ref-b",
            creditBatchId: "credit-batch-b",
            datapointIdsByMeasurementProperty: new Map([
              [productMassProperty, ["datapoint-product-mass-b"]],
            ]),
          },
        ],
        sourceBindingPlan: [
          {
            documentId: "document-inventory-a",
            sourceId: "source-inventory-a",
            nomaRole: "inventory",
            lineage: {
              entityType: "application",
              entityId: "application-a",
              entityLabel: "Application APP-A",
            },
            intendedTarget: {
              kind: "sequestration",
              groupKey: "co2-stored",
              componentId: "component-sequestration",
              componentBlueprintKey: "biochar_sequestration_1000_year",
              inputKey: "product_mass",
              creditBatchIds: ["credit-batch-a"],
            },
            mappingRevision: "revision-1",
          },
          {
            documentId: "document-inventory-b",
            sourceId: "source-inventory-b",
            nomaRole: "inventory",
            lineage: {
              entityType: "application",
              entityId: "application-b",
              entityLabel: "Application APP-B",
            },
            intendedTarget: {
              kind: "sequestration",
              groupKey: "co2-stored",
              componentId: "component-sequestration",
              componentBlueprintKey: "biochar_sequestration_1000_year",
              inputKey: "product_mass",
              creditBatchIds: ["credit-batch-b"],
            },
            mappingRevision: "revision-1",
          },
        ],
      }),
    ).resolves.toBe(2);

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "/datapoints/datapoint-product-mass-a",
      expect.objectContaining({ source_ids: ["source-inventory-a"] }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "/datapoints/datapoint-product-mass-b",
      expect.objectContaining({ source_ids: ["source-inventory-b"] }),
    );
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

  it("fails closed for sampled 200-year batches", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        batches: [sampledBatch("a", "CB-A")],
      }),
    ).toThrow(/200-year.*post-MVP.*not enabled/i);
  });

  it("fails closed for unsampled Method B batches", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        facilityReferenceSoilTemperature: null,
        batches: [
          {
            ...thousandYearBatch("u", "CB-U"),
            sampling: "unsampled",
          },
        ],
      }),
    ).toThrow(/unsampled Method B.*post-MVP.*not enabled/i);
  });

  it("emits the full per-replicate 1000-year payload without a soil sample", () => {
    const submissions = buildDurabilityMeasurementSampleSubmissions({
      ...common,
      facilityReferenceSoilTemperature: null,
      batches: [thousandYearBatch("t", "CB-T")],
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

  it("rejects multi-batch 1000-year removals before building registry requests", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        facilityReferenceSoilTemperature: null,
        batches: [
          thousandYearBatch("t1", "CB-T1"),
          thousandYearBatch("t2", "CB-T2"),
        ],
      }),
    ).toThrow(/supports exactly one credit batch.*single product_mass/);
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

  it("rejects 200-year before evaluating its soil-temperature payload", () => {
    expect(() =>
      buildDurabilityMeasurementSampleSubmissions({
        ...common,
        facilityReferenceSoilTemperature: null,
        batches: [sampledBatch("a", "CB-A")],
      }),
    ).toThrow(/200-year.*not enabled/i);
  });

  it("scales product mass by the per-run applied attribution", () => {
    const [pb] = buildDurabilityMeasurementSampleSubmissions({
      ...common,
      facilityReferenceSoilTemperature: null,
      batches: [thousandYearBatch("a", "CB-A")],
      attributionByRunId: new Map([["run-a", 0.5]]),
    });

    const massValue = pb.body.values.find(
      (v) => v.measurement_property.quantity_kind === "mass",
    );
    expect(massValue?.value.magnitude).toBe(500); // 1000 kg × 0.5
  });
});
