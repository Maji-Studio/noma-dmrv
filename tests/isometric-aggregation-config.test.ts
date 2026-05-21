import { describe, expect, it } from "vitest";
import {
  enrichWithFacilityConfig,
  type AggregatedProductionData,
  type FacilityEmissionConfig,
} from "@/lib/isometric/utils/aggregation";

const baseAgg: AggregatedProductionData = {
  weightedOrganicCarbonPercent: 80,
  weightedHToCorgRatio: 0.4,
  weightedOToCorgRatio: 0.2,
  weightedAshPercent: 5,
  weightedMoisturePercent: 10,
  totalBiocharDryMassKg: 1000,
  totalFeedstockDryMassKg: 4000,
  totalStartupDieselLitres: 100,
  totalGensetDieselLitres: 200,
  totalElectricityKwh: 1000,
  feedstockTransportAvgDistanceKm: null,
  biocharTransportAvgDistanceKm: null,
  sampleTransportAvgDistanceKm: null,
  sampleTransportMassDistanceTonneKm: 0,
  biomassElectricityKwh: null,
  pyrolysisElectricityKwh: null,
  biocharElectricityKwh: null,
  biomassGensetKwh: null,
  pyrolysisGensetKwh: null,
  biocharGensetKwh: null,
  earliestStartTime: new Date("2026-01-01T00:00:00Z"),
  latestEndTime: new Date("2026-01-31T23:59:59Z"),
  sourceProductionRunIds: ["pr_1"],
  warnings: [],
};

const config: FacilityEmissionConfig = {
  gensetEnergyYieldKwhPerLitre: 3,
  stageSplitBiomassPct: 20,
  stageSplitPyrolysisPct: 70,
  stageSplitBiocharPct: 10,
};

describe("enrichWithFacilityConfig", () => {
  it("splits combined electricity across the three stages by the configured ratios", () => {
    const r = enrichWithFacilityConfig(baseAgg, config);
    expect(r.biomassElectricityKwh).toBe(200); // 1000 × 0.20
    expect(r.pyrolysisElectricityKwh).toBe(700); // 1000 × 0.70
    expect(r.biocharElectricityKwh).toBe(100); // 1000 × 0.10
  });

  it("is emissions-neutral — per-stage electricity sums to the combined total", () => {
    const r = enrichWithFacilityConfig(baseAgg, config);
    const sum =
      (r.biomassElectricityKwh ?? 0) +
      (r.pyrolysisElectricityKwh ?? 0) +
      (r.biocharElectricityKwh ?? 0);
    expect(sum).toBeCloseTo(baseAgg.totalElectricityKwh, 6);
  });

  it("converts genset litres to kWh via the yield, then splits by stage", () => {
    const r = enrichWithFacilityConfig(baseAgg, config);
    // 200 L × 3 kWh/L = 600 kWh genset
    expect(r.biomassGensetKwh).toBe(120); // 600 × 0.20
    expect(r.pyrolysisGensetKwh).toBe(420); // 600 × 0.70
    expect(r.biocharGensetKwh).toBe(60); // 600 × 0.10
  });

  it("genset per-stage kWh sums to litres × yield", () => {
    const r = enrichWithFacilityConfig(baseAgg, config);
    const sum =
      (r.biomassGensetKwh ?? 0) +
      (r.pyrolysisGensetKwh ?? 0) +
      (r.biocharGensetKwh ?? 0);
    expect(sum).toBeCloseTo(
      baseAgg.totalGensetDieselLitres * config.gensetEnergyYieldKwhPerLitre,
      6,
    );
  });

  it("does not mutate the input aggregation", () => {
    enrichWithFacilityConfig(baseAgg, config);
    expect(baseAgg.biomassElectricityKwh).toBeNull();
    expect(baseAgg.pyrolysisGensetKwh).toBeNull();
  });
});
