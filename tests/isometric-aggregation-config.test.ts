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
  feedstockTransportMassDistanceTonneKm: null,
  biocharTransportMassDistanceTonneKm: null,
  sampleTransportMassDistanceTonneKm: 0,
  totalGensetKwh: null,
  earliestStartTime: new Date("2026-01-01T00:00:00Z"),
  latestEndTime: new Date("2026-01-31T23:59:59Z"),
  sourceProductionRunIds: ["pr_1"],
  warnings: [],
};

const config: FacilityEmissionConfig = {
  gensetEnergyYieldKwhPerLitre: 3,
};

describe("enrichWithFacilityConfig", () => {
  it("converts the combined genset litres to kWh via the yield (single point, ADR 0015)", () => {
    const r = enrichWithFacilityConfig(baseAgg, config);
    // 200 L × 3 kWh/L = 600 kWh genset — one combined figure, no per-stage split.
    expect(r.totalGensetKwh).toBe(600);
  });

  it("leaves the combined electricity figure unchanged (already the submitted total)", () => {
    const r = enrichWithFacilityConfig(baseAgg, config);
    expect(r.totalElectricityKwh).toBe(baseAgg.totalElectricityKwh);
  });

  it("does not mutate the input aggregation", () => {
    enrichWithFacilityConfig(baseAgg, config);
    expect(baseAgg.totalGensetKwh).toBeNull();
  });
});
