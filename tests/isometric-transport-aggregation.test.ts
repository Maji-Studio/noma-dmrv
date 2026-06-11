import { describe, expect, it } from "vitest";
import type { TransportLeg } from "@/db/schema";
import {
  aggregateTransportLegs,
  enrichWithTransportLegs,
  type AggregatedProductionData,
} from "@/lib/isometric/utils/aggregation";

// Minimal-shape TransportLeg builder. Only the columns the aggregator reads are
// populated. The emission factor is no longer stored on legs (it lives in the
// Isometric component blueprint), so the aggregator only needs distance, load
// mass, and method — and mass-weights distance so Certify's
// `distance × Σmass × factor` equals the per-leg sum (Transportation v1.1 §5).
function leg(distanceKm: number, loadMassKg: number | null): TransportLeg {
  return {
    id: "tl_" + distanceKm + "_" + (loadMassKg ?? "null"),
    entityType: "biochar",
    entityId: "ent_test",
    originGpsLatitude: null,
    originGpsLongitude: null,
    originName: null,
    destinationGpsLatitude: null,
    destinationGpsLongitude: null,
    destinationName: null,
    distanceKm,
    distanceSource: null,
    transportMethodType: "road",
    vehicleType: null,
    modelYear: null,
    loadMassKg,
    calculationMethodType: "distance_based",
    isDerived: false,
    billOfLading: null,
    weighScaleTicketRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("aggregateTransportLegs", () => {
  it("returns {distanceKm: null, warning: null} when no legs are supplied", () => {
    const result = aggregateTransportLegs([], "Feedstock");
    expect(result.distanceKm).toBeNull();
    expect(result.warning).toBeNull();
  });

  it("returns the single distance when one leg is supplied", () => {
    const result = aggregateTransportLegs([leg(50, 1000)], "Feedstock");
    expect(result.distanceKm).toBe(50);
    expect(result.warning).toBeNull();
  });

  it("computes mass-weighted distance across multiple legs", () => {
    // (50*1000 + 100*4000) / (1000 + 4000) = 450000 / 5000 = 90
    const result = aggregateTransportLegs(
      [leg(50, 1000), leg(100, 4000)],
      "Feedstock",
    );
    expect(result.distanceKm).toBe(90);
    expect(result.warning).toBeNull();
  });

  it("warns when a leg is missing load_mass_kg (per-leg accounting requires it)", () => {
    const result = aggregateTransportLegs(
      [leg(50, 1000), leg(100, null)],
      "Sample",
    );
    expect(result.distanceKm).toBeNull();
    expect(result.warning).toMatch(/missing load_mass_kg/);
  });

  it("warns when legs mix transport-factor fields (different method)", () => {
    // Collapsing to one mass-weighted distance is only valid when every leg
    // shares the fields that select the Certify emission factor. A differing
    // transportMethodType must surface a warning instead of a value.
    const result = aggregateTransportLegs(
      [leg(50, 1000), { ...leg(100, 1000), transportMethodType: "rail" }],
      "Feedstock",
    );
    expect(result.distanceKm).toBeNull();
    expect(result.warning).toMatch(/mix factor fields/);
  });

  it("handles zero-distance legs cleanly", () => {
    // (0*1000 + 100*1000) / 2000 = 50
    const result = aggregateTransportLegs(
      [leg(0, 1000), leg(100, 1000)],
      "Feedstock",
    );
    expect(result.distanceKm).toBe(50);
    expect(result.warning).toBeNull();
  });
});

describe("enrichWithTransportLegs", () => {
  const baseAgg: AggregatedProductionData = {
    weightedOrganicCarbonPercent: 80,
    weightedHToCorgRatio: 0.4,
    weightedOToCorgRatio: 0.2,
    weightedAshPercent: 5,
    weightedMoisturePercent: 10,
    totalBiocharDryMassKg: 1000,
    totalFeedstockDryMassKg: 4000,
    totalStartupDieselLitres: 50,
    totalGensetDieselLitres: 20,
    totalElectricityKwh: 200,
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

  it("populates all three transport fields with mass-weighted distances", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [leg(50, 1000), leg(100, 4000)], // → 90
      biochar: [leg(200, 1000)], // → 200
      sample: [leg(10, 500), leg(30, 500)], // → 20
    });

    expect(enriched.feedstockTransportAvgDistanceKm).toBe(90);
    expect(enriched.biocharTransportAvgDistanceKm).toBe(200);
    expect(enriched.sampleTransportAvgDistanceKm).toBe(20);
    expect(enriched.warnings).toEqual([]);
  });

  it("computes sample mass-distance as Σ(distance × load mass in tonnes)", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [],
      biochar: [],
      // 10 km × 0.5 t + 30 km × 0.5 t = 5 + 15 = 20 t·km
      sample: [leg(10, 500), leg(30, 500)],
    });
    expect(enriched.sampleTransportMassDistanceTonneKm).toBe(20);
  });

  it("sample mass-distance is 0 when there are no sample legs", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [leg(50, 1000)],
      biochar: [],
      sample: [],
    });
    expect(enriched.sampleTransportMassDistanceTonneKm).toBe(0);
  });

  it("does not mutate the input aggregation object", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [leg(50, 1000)],
      biochar: [],
      sample: [],
    });

    expect(enriched).not.toBe(baseAgg);
    expect(baseAgg.feedstockTransportAvgDistanceKm).toBeNull();
    expect(enriched.feedstockTransportAvgDistanceKm).toBe(50);
  });

  it("preserves all non-transport fields unchanged", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [],
      biochar: [],
      sample: [],
    });

    expect(enriched.totalBiocharDryMassKg).toBe(baseAgg.totalBiocharDryMassKg);
    expect(enriched.weightedOrganicCarbonPercent).toBe(
      baseAgg.weightedOrganicCarbonPercent,
    );
    expect(enriched.sourceProductionRunIds).toEqual(
      baseAgg.sourceProductionRunIds,
    );
  });

  it("sets transport fields to null when categories have no legs", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [],
      biochar: [leg(100, 1000)],
      sample: [],
    });

    expect(enriched.feedstockTransportAvgDistanceKm).toBeNull();
    expect(enriched.biocharTransportAvgDistanceKm).toBe(100);
    expect(enriched.sampleTransportAvgDistanceKm).toBeNull();
  });

  it("appends a warning per category with a leg missing load mass", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [leg(50, 1000), leg(100, null)],
      biochar: [leg(200, 1000)],
      sample: [leg(10, 500), leg(30, null)],
    });

    expect(enriched.feedstockTransportAvgDistanceKm).toBeNull();
    expect(enriched.biocharTransportAvgDistanceKm).toBe(200);
    expect(enriched.sampleTransportAvgDistanceKm).toBeNull();
    expect(enriched.warnings).toHaveLength(2);
    expect(enriched.warnings[0]).toMatch(/Feedstock/);
    expect(enriched.warnings[1]).toMatch(/Sample/);
  });

  it("preserves pre-existing warnings on the base aggregation", () => {
    const aggWithExisting: AggregatedProductionData = {
      ...baseAgg,
      warnings: ["Run PR-2026-001: missing biocharDryMassKg"],
    };
    const enriched = enrichWithTransportLegs(aggWithExisting, {
      feedstock: [leg(50, 1000)],
      biochar: [],
      sample: [],
    });
    expect(enriched.warnings[0]).toMatch(/PR-2026-001/);
  });
});
