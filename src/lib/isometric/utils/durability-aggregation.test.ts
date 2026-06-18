import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import type { ProductionRunWithSamples } from "./aggregation";
import {
  buildPerBatchDurabilityData,
  reconcileDeclaredHToCorg,
  resolveConservativeSoilTemperature,
} from "./durability-aggregation";

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

function run(
  id: string,
  code: string,
  biocharDryMassKg: number | null,
  samples: Sample[],
): ProductionRunWithSamples {
  return { id, code, biocharDryMassKg, samples } as unknown as ProductionRunWithSamples;
}

describe("buildPerBatchDurabilityData (per-batch lists, D2 revision)", () => {
  it("produces one datapoint per run with replicate means and sample std-dev", () => {
    const r = run("run-1", "PR-1", 1000, [
      sample({ hToCOrgRatio: 0.28, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 }),
      sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 82, organicCarbonPercent: 81, inorganicCarbonPercent: 1 }),
      sample({ hToCOrgRatio: 0.32, totalCarbonPercent: 84, organicCarbonPercent: 83, inorganicCarbonPercent: 1 }),
    ]);
    const [dp] = buildPerBatchDurabilityData([r]);
    expect(dp.productionRunId).toBe("run-1");
    expect(dp.productionRunCode).toBe("PR-1");
    expect(dp.sampled).toBe(true);
    expect(dp.replicateCount).toBe(3);
    expect(dp.hToCorgRatio?.mean).toBeCloseTo(0.3, 5);
    // sample std-dev (n-1) of [0.28,0.30,0.32] = 0.02
    expect(dp.hToCorgRatio?.stdDev).toBeCloseTo(0.02, 5);
    expect(dp.totalCarbonPercent?.mean).toBeCloseTo(82, 5);
    expect(dp.inorganicCarbonPercent?.mean).toBeCloseTo(1, 5);
    expect(dp.productMassKg).toBe(1000);
  });

  it("derives inorganic carbon as max(0, total − organic) when the lab omits it", () => {
    const r = run("run-1", "PR-1", 500, [
      sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 78, inorganicCarbonPercent: null }),
      sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: null }),
    ]);
    const [dp] = buildPerBatchDurabilityData([r]);
    // derived inorganic per replicate: (80-78)=2, (80-79)=1 → mean 1.5
    expect(dp.inorganicCarbonPercent?.mean).toBeCloseTo(1.5, 5);
  });

  it("never derives a negative inorganic carbon (clamped at 0)", () => {
    const r = run("run-1", "PR-1", 500, [
      sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 78, organicCarbonPercent: 80, inorganicCarbonPercent: null }),
    ]);
    const [dp] = buildPerBatchDurabilityData([r]);
    expect(dp.inorganicCarbonPercent?.mean).toBe(0);
  });

  it("marks a run with no usable chemistry as unsampled but keeps its product mass", () => {
    const r = run("run-2", "PR-2", 700, []);
    const [dp] = buildPerBatchDurabilityData([r]);
    expect(dp.sampled).toBe(false);
    expect(dp.replicateCount).toBe(0);
    expect(dp.hToCorgRatio).toBeNull();
    expect(dp.productMassKg).toBe(700);
  });

  it("scales product mass by the run's attribution factor", () => {
    const r = run("run-1", "PR-1", 1000, [
      sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 }),
    ]);
    const [dp] = buildPerBatchDurabilityData([r], new Map([["run-1", 0.4]]));
    expect(dp.productMassKg).toBeCloseTo(400, 5);
  });

  it("returns null std-dev for a single replicate (no dispersion)", () => {
    const r = run("run-1", "PR-1", 100, [
      sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 }),
    ]);
    const [dp] = buildPerBatchDurabilityData([r]);
    expect(dp.hToCorgRatio?.mean).toBeCloseTo(0.3, 5);
    expect(dp.hToCorgRatio?.stdDev).toBeNull();
  });
});

describe("resolveConservativeSoilTemperature (D2 soil-temp resolution)", () => {
  it("uses the MAX site temperature (conservative worst-case, module §5)", () => {
    const r = resolveConservativeSoilTemperature([12, 18.4, 15]);
    expect(r.maxSoilTemperatureC).toBe(18.4);
    expect(r.effectiveSoilTemperatureC).toBe(18.4);
    expect(r.temperatureFloored).toBe(false);
    expect(r.conservativeEstimate).toBe(true);
    expect(r.method).toMatch(/conservative/i);
  });

  it("raises a subdivide warning when sites span more than 1 °C", () => {
    const r = resolveConservativeSoilTemperature([10, 14]);
    expect(r.spreadC).toBeCloseTo(4, 5);
    expect(r.subdivideWarning).toBe(true);
    expect(r.warnings.some((w) => /subdiv/i.test(w))).toBe(true);
  });

  it("does not warn when sites are within 1 °C", () => {
    const r = resolveConservativeSoilTemperature([12.0, 12.6]);
    expect(r.subdivideWarning).toBe(false);
  });

  it("applies the 7 °C floor to a cold conservative max", () => {
    const r = resolveConservativeSoilTemperature([3, 5]);
    expect(r.maxSoilTemperatureC).toBe(5);
    expect(r.effectiveSoilTemperatureC).toBe(7);
    expect(r.temperatureFloored).toBe(true);
  });

  it("returns null and a warning when no site has a soil temperature", () => {
    const r = resolveConservativeSoilTemperature([null, undefined]);
    expect(r.effectiveSoilTemperatureC).toBeNull();
    expect(r.maxSoilTemperatureC).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("reconcileDeclaredHToCorg (D5a divergence guard)", () => {
  it("returns no warning when declared matches aggregated within tolerance", () => {
    expect(reconcileDeclaredHToCorg(0.3, 0.305)).toBeNull();
  });

  it("warns when declared diverges beyond tolerance", () => {
    const w = reconcileDeclaredHToCorg(0.3, 0.45);
    expect(w).not.toBeNull();
    expect(w).toMatch(/0\.3/);
  });

  it("returns no warning when either value is missing", () => {
    expect(reconcileDeclaredHToCorg(null, 0.3)).toBeNull();
    expect(reconcileDeclaredHToCorg(0.3, null)).toBeNull();
  });
});
