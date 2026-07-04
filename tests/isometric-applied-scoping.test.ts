/**
 * Emission-input bucket tests for `aggregateProductionRuns` (§8.6.2,
 * issue #349, ADR 0020).
 *
 * `attributionByRunId` — the per-run applied fraction (linear mass
 * allocation) — scopes ONLY the STORED-bucket biochar mass and the chemistry
 * weights. PRODUCTION-bucket inputs (feedstock mass, diesel, electricity)
 * sum full run totals: they front-load once on the credit batch's claiming
 * GHG entry, with no applied-mass weighting. These tests pin that split —
 * a regression back to uniform proration MUST fail here.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateProductionRuns,
  type ProductionRunWithSamples,
} from "@/lib/isometric/utils/aggregation";

function run(
  overrides: Partial<Record<string, unknown>> = {},
): ProductionRunWithSamples {
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
    samples: [{ organicCarbonPercent: 80 }],
    ...overrides,
  } as unknown as ProductionRunWithSamples;
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

  it("weights carbon content by applied mass, not raw output", () => {
    const agg = aggregateProductionRuns(
      [
        run({
          id: "a",
          biocharDryMassKg: 1000,
          samples: [{ organicCarbonPercent: 90 }],
        }),
        run({
          id: "b",
          biocharDryMassKg: 1000,
          samples: [{ organicCarbonPercent: 70 }],
        }),
      ],
      new Map([
        ["a", 1.0], // weight 1000
        ["b", 0.5], // weight 500
      ]),
    );
    // (90·1000 + 70·500) / (1000 + 500) = 125000 / 1500
    expect(agg.weightedOrganicCarbonPercent).toBeCloseTo(83.333, 2);
  });

  it("drops a run with a zero attribution factor from weighted averages", () => {
    const agg = aggregateProductionRuns(
      [
        run({
          id: "a",
          biocharDryMassKg: 1000,
          samples: [{ organicCarbonPercent: 90 }],
        }),
        run({
          id: "b",
          biocharDryMassKg: 1000,
          samples: [{ organicCarbonPercent: 10 }],
        }),
      ],
      new Map([
        ["a", 1.0],
        ["b", 0],
      ]),
    );
    // Run b contributes nothing — the average is run a's value alone.
    expect(agg.weightedOrganicCarbonPercent).toBeCloseTo(90);
  });
});
