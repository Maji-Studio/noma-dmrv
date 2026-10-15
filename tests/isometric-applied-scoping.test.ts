/**
 * Emission-input bucket tests for `aggregateProductionRuns` (§8.6.2,
 * issue #349, ADR 0020).
 *
 * `attributionByRunId` — the per-run applied fraction (linear mass
 * allocation) — scopes ONLY the STORED-bucket biochar mass. PRODUCTION-bucket inputs (feedstock mass, diesel, electricity)
 * sum full run totals: they front-load once on the credit batch's claiming
 * GHG entry, with no applied-mass weighting. These tests pin that split —
 * a regression back to uniform proration MUST fail here.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  aggregateProductionRuns,
  enrichWithTransportLegs,
  type AggregatedProductionData,
  type ProductionRunForCertification,
} from "@/lib/isometric/utils/aggregation";

function run(
  overrides: Partial<Record<string, unknown>> = {},
): ProductionRunForCertification {
  return {
    id: "run-1",
    code: "RUN-1",
    startTime: new Date("2026-05-01T00:00:00Z"),
    endTime: new Date("2026-05-02T00:00:00Z"),
    biocharDryMassKg: 1000,
    feedstockMassDryKg: 4000,
    dieselOperationLiters: 100,
    preprocessingFuelLiters: 0,
    dieselGensetLiters: 50,
    electricityKwh: 200,
    ...overrides,
  } as unknown as ProductionRunForCertification;
}

describe("aggregateProductionRuns — emission-input buckets (§8.6.2)", () => {
  it("counts full run totals when no attribution map is supplied", () => {
    const agg = aggregateProductionRuns([run({ id: "a" })]);
    expect(agg.totalBiocharDryMassKg).toBe(1000);
    expect(agg.totalFeedstockDryMassKg).toBe(4000);
    expect(agg.totalStartupDieselLitres).toBe(100);
    expect(agg.totalGensetDieselLitres).toBe(50);
    // Combined diesel (issue #319) = startup + genset litres.
    expect(agg.totalDieselLitres).toBe(150);
    expect(agg.totalElectricityKwh).toBe(200);
  });

  it("aggregates the run-derived dry feedstock value for certification", () => {
    const agg = aggregateProductionRuns([
      run({ id: "a", feedstockMassDryKg: 2_400 }),
    ]);

    // A 3,000 kg wet draw at 20% moisture yields 2,400 kg dry. Bin stock and
    // lineage stay wet, while certification deliberately consumes this value.
    expect(agg.totalFeedstockDryMassKg).toBe(2_400);
  });

  it("buckets preprocessing fuel with genset, not startup (generator/startup diesel split)", () => {
    // Startup = reactor-startup / plant diesel only; the generator
    // ("summarized") figure absorbs preprocessing fuel (docs/isometric/changes.md).
    const agg = aggregateProductionRuns([
      run({
        id: "a",
        dieselOperationLiters: 100,
        preprocessingFuelLiters: 10,
        dieselGensetLiters: 50,
      }),
    ]);
    expect(agg.totalStartupDieselLitres).toBe(100);
    expect(agg.totalGensetDieselLitres).toBe(60);
    // Combined is unchanged by the re-bucket (still the full run diesel sum).
    expect(agg.totalDieselLitres).toBe(160);
  });

  it("scales only the stored-bucket biochar mass by the attribution factor; production-bucket inputs stay full", () => {
    const agg = aggregateProductionRuns(
      [run({ id: "a" })],
      new Map([["a", 0.6]]),
    );
    // STORED bucket: 60% of the biochar reached this removal's applications.
    expect(agg.totalBiocharDryMassKg).toBeCloseTo(600);
    // PRODUCTION bucket: full run totals — front-loaded, never prorated.
    expect(agg.totalFeedstockDryMassKg).toBe(4000);
    expect(agg.totalStartupDieselLitres).toBe(100);
    expect(agg.totalGensetDieselLitres).toBe(50);
    expect(agg.totalDieselLitres).toBe(150);
    expect(agg.totalElectricityKwh).toBe(200);
  });

  it("clamps an attribution factor above 1 to full attribution", () => {
    const agg = aggregateProductionRuns(
      [run({ id: "a" })],
      new Map([["a", 1.5]]),
    );
    expect(agg.totalBiocharDryMassKg).toBe(1000);
  });

  it("clamps a negative attribution factor to zero for the stored bucket only", () => {
    const agg = aggregateProductionRuns(
      [run({ id: "a" })],
      new Map([["a", -0.2]]),
    );
    expect(agg.totalBiocharDryMassKg).toBe(0);
    // Production-bucket inputs are unaffected by the (clamped) factor.
    expect(agg.totalFeedstockDryMassKg).toBe(4000);
    expect(agg.totalElectricityKwh).toBe(200);
  });

  it("sums applied biochar across runs in a multi-batch removal", () => {
    const agg = aggregateProductionRuns(
      [
        run({ id: "a", biocharDryMassKg: 1000 }),
        run({ id: "b", biocharDryMassKg: 2000 }),
      ],
      new Map([
        ["a", 0.6], // 600 kg applied
        ["b", 0.5], // 1000 kg applied
      ]),
    );
    expect(agg.totalBiocharDryMassKg).toBeCloseTo(1600);
    expect(agg.sourceProductionRunIds.sort()).toEqual(["a", "b"]);
  });

  it("leaves chemistry to credit-batch Sample aggregation", () => {
    const agg = aggregateProductionRuns([run()]);
    expectTypeOf(agg).not.toExtend<AggregatedProductionData>();
    expect(agg).not.toHaveProperty("weightedOrganicCarbonPercent");
    expect(agg).not.toHaveProperty("weightedHToCorgRatio");
    expect(agg).not.toHaveProperty("weightedOToCorgRatio");
    expect(agg).not.toHaveProperty("weightedAshPercent");
    expect(agg).not.toHaveProperty("weightedMoisturePercent");

    const enriched = enrichWithTransportLegs(agg, {
      feedstock: [], biochar: [], sample: [],
    });
    expectTypeOf(enriched).not.toExtend<AggregatedProductionData>();
    expect(enriched).not.toHaveProperty("weightedOrganicCarbonPercent");
    expect(enriched).not.toHaveProperty("weightedHToCorgRatio");
    expect(enriched).not.toHaveProperty("weightedOToCorgRatio");
  });
});
