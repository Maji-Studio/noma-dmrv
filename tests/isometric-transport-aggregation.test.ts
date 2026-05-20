import { describe, expect, it } from "vitest";
import type { TransportLeg } from "@/db/schema";
import {
  aggregateTransportLegs,
  enrichWithTransportLegs,
  type AggregatedProductionData,
} from "@/lib/isometric/utils/aggregation";

// Minimal-shape TransportLeg builder. Only the columns the aggregator reads
// are populated; the rest stay typed but nullish to keep tests focused on
// the uniformity rules introduced for Isometric Transportation v1.1 §5
// compliance.
function leg(
  distanceKm: number,
  loadMassKg: number | null,
  opts: {
    method?: TransportLeg["calculationMethodType"];
    factor?: number | null;
  } = {},
): TransportLeg {
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
    calculationMethodType: opts.method ?? "distance_based",
    emissionFactorUsed: opts.factor === undefined ? 0.12 : opts.factor,
    emissionFactorSource: null,
    transportEmissionsCo2eKg: null,
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

  it("returns the single distance when one uniform leg is supplied", () => {
    const result = aggregateTransportLegs([leg(50, 1000)], "Feedstock");
    expect(result.distanceKm).toBe(50);
    expect(result.warning).toBeNull();
  });

  it("computes mass-weighted distance across multiple uniform legs", () => {
    // (50*1000 + 100*4000) / (1000 + 4000) = 450000 / 5000 = 90
    const result = aggregateTransportLegs(
      [leg(50, 1000), leg(100, 4000)],
      "Feedstock",
    );
    expect(result.distanceKm).toBe(90);
    expect(result.warning).toBeNull();
  });

  it("warns when legs in a category mix calculation methods", () => {
    const result = aggregateTransportLegs(
      [leg(50, 1000, { method: "distance_based" }), leg(100, 1000, { method: "energy_usage" })],
      "Feedstock",
    );
    expect(result.distanceKm).toBeNull();
    expect(result.warning).toMatch(/mix calculation methods/);
    expect(result.warning).toMatch(/§5/);
  });

  it("warns when legs in a category mix emission factors", () => {
    const result = aggregateTransportLegs(
      [leg(50, 1000, { factor: 0.12 }), leg(100, 1000, { factor: 0.25 })],
      "Biochar",
    );
    expect(result.distanceKm).toBeNull();
    expect(result.warning).toMatch(/mix emission factors/);
  });

  it("warns when a leg is missing load_mass_kg (per-leg accounting requires it)", () => {
    const result = aggregateTransportLegs(
      [leg(50, 1000), leg(100, null)],
      "Sample",
    );
    expect(result.distanceKm).toBeNull();
    expect(result.warning).toMatch(/missing load_mass_kg/);
  });

  it("warns when a leg is missing emission_factor_used", () => {
    const result = aggregateTransportLegs(
      [leg(50, 1000, { factor: null })],
      "Sample",
    );
    expect(result.distanceKm).toBeNull();
    expect(result.warning).toMatch(/missing emission_factor_used/);
  });

  it("tolerates floating-point factor jitter within 1e-9", () => {
    const result = aggregateTransportLegs(
      [
        leg(50, 1000, { factor: 0.12 }),
        leg(100, 1000, { factor: 0.12 + 1e-12 }),
      ],
      "Feedstock",
    );
    expect(result.warning).toBeNull();
    expect(result.distanceKm).toBeCloseTo(75);
  });

  it("handles zero-distance legs cleanly when uniform", () => {
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

  it("appends a warning per non-uniform category instead of returning a distance", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [
        leg(50, 1000, { factor: 0.12 }),
        leg(100, 1000, { factor: 0.25 }),
      ],
      biochar: [leg(200, 1000)],
      sample: [
        leg(10, 500, { method: "distance_based" }),
        leg(30, 500, { method: "energy_usage" }),
      ],
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
      biochar: [
        leg(100, 1000, { factor: 0.1 }),
        leg(200, 1000, { factor: 0.5 }),
      ],
      sample: [],
    });

    expect(enriched.warnings[0]).toMatch(/missing biocharDryMassKg/);
    expect(enriched.warnings[1]).toMatch(/Biochar transport legs mix/);
  });
});
