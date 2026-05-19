import { describe, expect, it } from "vitest";
import type { TransportLeg } from "@/db/schema";
import {
  aggregateTransportLegs,
  enrichWithTransportLegs,
  type AggregatedProductionData,
} from "@/lib/isometric/utils/aggregation";

// Minimal-shape TransportLeg builder. Only the columns the aggregator reads
// are populated; the rest stay typed but undefined-ish to keep tests focused.
function leg(distanceKm: number, loadMassKg: number | null): TransportLeg {
  return {
    id: "tl_" + Math.random().toString(36).slice(2, 8),
    entityType: "delivery",
    entityId: "ent_test",
    originGpsLatitude: null,
    originGpsLongitude: null,
    originName: null,
    destinationGpsLatitude: null,
    destinationGpsLongitude: null,
    destinationName: null,
    distanceKm,
    transportMethodType: "road",
    vehicleType: null,
    modelYear: null,
    fuelType: null,
    fuelConsumedLiters: null,
    electricityKwh: null,
    loadMassKg,
    calculationMethodType: "distance_based",
    emissionFactorUsed: null,
    emissionFactorSource: null,
    transportEmissionsCo2eKg: null,
    billOfLading: null,
    weighScaleTicketRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("aggregateTransportLegs", () => {
  it("returns null when no legs are supplied", () => {
    expect(aggregateTransportLegs([])).toBeNull();
  });

  it("returns the single distance when one leg is supplied", () => {
    expect(aggregateTransportLegs([leg(50, 1000)])).toBe(50);
  });

  it("computes mass-weighted average across multiple legs", () => {
    // (50*1000 + 100*4000) / (1000 + 4000) = 450000 / 5000 = 90
    const result = aggregateTransportLegs([leg(50, 1000), leg(100, 4000)]);
    expect(result).toBe(90);
  });

  it("equals simple average when all loads are equal", () => {
    // (50 + 100 + 150) * 1000 / (3 * 1000) = 100
    const result = aggregateTransportLegs([
      leg(50, 1000),
      leg(100, 1000),
      leg(150, 1000),
    ]);
    expect(result).toBe(100);
  });

  it("skips legs with null load_mass_kg (they don't contribute to either sum)", () => {
    // Only the 100km leg with 1000kg counts; the null-mass leg is ignored.
    const result = aggregateTransportLegs([leg(50, null), leg(100, 1000)]);
    expect(result).toBe(100);
  });

  it("falls back to a simple mean of distances when every leg has null load_mass_kg", () => {
    // Energy-usage legs don't require load mass; we keep them in the average
    // by switching to a simple mean so submission isn't blocked.
    expect(aggregateTransportLegs([leg(50, null), leg(100, null)])).toBe(75);
  });

  it("handles zero-distance legs cleanly", () => {
    // (0*1000 + 100*1000) / 2000 = 50
    expect(aggregateTransportLegs([leg(0, 1000), leg(100, 1000)])).toBe(50);
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
    totalDieselLiters: 50,
    totalElectricityKwh: 200,
    feedstockTransportAvgDistanceKm: null,
    biocharTransportAvgDistanceKm: null,
    sampleTransportAvgDistanceKm: null,
    earliestStartTime: new Date("2026-01-01T00:00:00Z"),
    latestEndTime: new Date("2026-01-31T23:59:59Z"),
    sourceProductionRunIds: ["pr_1"],
    warnings: [],
  };

  it("populates all three transport fields with mass-weighted averages", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [leg(50, 1000), leg(100, 4000)], // → 90
      biochar: [leg(200, 1000)], // → 200
      sample: [leg(10, 500), leg(30, 500)], // → 20
    });

    expect(enriched.feedstockTransportAvgDistanceKm).toBe(90);
    expect(enriched.biocharTransportAvgDistanceKm).toBe(200);
    expect(enriched.sampleTransportAvgDistanceKm).toBe(20);
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
});
