/**
 * Applied-biochar scoping tests
 *
 * A Removal counts only the biochar that actually got applied to soil
 * (ADR 0003). `aggregateProductionRuns` takes an `attributionByRunId` map —
 * the per-run applied fraction (linear mass allocation) — and scales every
 * run-derived quantity by it. These tests pin that math.
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

describe("aggregateProductionRuns — applied-biochar scoping", () => {
  it("counts full run output when no attribution map is supplied", () => {
    const agg = aggregateProductionRuns([run({ id: "a" })]);
    expect(agg.totalBiocharDryMassKg).toBe(1000);
    expect(agg.totalFeedstockDryMassKg).toBe(4000);
    expect(agg.totalStartupDieselLitres).toBe(100);
    expect(agg.totalGensetDieselLitres).toBe(50);
    expect(agg.totalElectricityKwh).toBe(200);
  });

  it("scales a partially-applied run by its attribution factor", () => {
    const agg = aggregateProductionRuns(
      [run({ id: "a" })],
      new Map([["a", 0.6]]),
    );
    // 60% of every run-derived quantity reaches this removal.
    expect(agg.totalBiocharDryMassKg).toBeCloseTo(600);
    expect(agg.totalFeedstockDryMassKg).toBeCloseTo(2400);
    expect(agg.totalStartupDieselLitres).toBeCloseTo(60);
    expect(agg.totalGensetDieselLitres).toBeCloseTo(30);
    expect(agg.totalElectricityKwh).toBeCloseTo(120);
  });

  it("clamps an attribution factor above 1 to full attribution", () => {
    const agg = aggregateProductionRuns(
      [run({ id: "a" })],
      new Map([["a", 1.5]]),
    );
    expect(agg.totalBiocharDryMassKg).toBe(1000);
  });

  it("clamps a negative attribution factor to zero", () => {
    const agg = aggregateProductionRuns(
      [run({ id: "a" })],
      new Map([["a", -0.2]]),
    );
    expect(agg.totalBiocharDryMassKg).toBe(0);
    expect(agg.totalFeedstockDryMassKg).toBe(0);
    expect(agg.totalElectricityKwh).toBe(0);
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
