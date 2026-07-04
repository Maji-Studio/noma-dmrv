import { describe, expect, it } from "vitest";
import type { TransportLeg } from "@/db/schema";
import {
  aggregateTransportMassDistance,
  enrichWithTransportLegs,
  type AggregatedProductionData,
} from "@/lib/isometric/utils/aggregation";

// Minimal-shape TransportLeg builder. Only the columns the aggregator reads are
// populated. The emission factor is NOT stored on legs (it lives on the
// Isometric `mass_distance_based_ci_emissions` blueprint as a fixed input), so
// the aggregator only needs distance, load mass, and the factor-selecting
// fields — and sums each leg's distance × load-mass (tonne·km) so Certify's
// `mass_distance × factor` equals the per-leg sum (Transportation v1.1 §5).
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

describe("aggregateTransportMassDistance", () => {
  it("returns {massDistanceTonneKm: null, warning: null} when no legs are supplied", () => {
    const result = aggregateTransportMassDistance([], "Feedstock");
    expect(result.massDistanceTonneKm).toBeNull();
    expect(result.warning).toBeNull();
  });

  it("returns distance × load-mass (tonne·km) for a single leg", () => {
    // 50 km × 1.0 t = 50 t·km
    const result = aggregateTransportMassDistance([leg(50, 1000)], "Feedstock");
    expect(result.massDistanceTonneKm).toBe(50);
    expect(result.warning).toBeNull();
  });

  it("sums Σⱼ(distⱼ × massⱼ) across multiple legs (mass-weighted)", () => {
    // The "storage bins pile up" case: a run's feedstock arrives across two
    // deliveries. 50 km × 1 t + 100 km × 4 t = 50 + 400 = 450 t·km. The larger
    // load over the longer distance dominates — exactly the mass-weighting.
    const result = aggregateTransportMassDistance(
      [leg(50, 1000), leg(100, 4000)],
      "Feedstock",
    );
    expect(result.massDistanceTonneKm).toBe(450);
    expect(result.warning).toBeNull();
  });

  it("warns when a leg is missing load_mass_kg (per-leg accounting requires it)", () => {
    const result = aggregateTransportMassDistance(
      [leg(50, 1000), leg(100, null)],
      "Sample",
    );
    expect(result.massDistanceTonneKm).toBeNull();
    expect(result.warning).toMatch(/missing load_mass_kg/);
  });

  it("warns when legs mix transport-factor fields (different method)", () => {
    // Collapsing to one mass_distance scalar is only valid when every leg
    // shares the fields that select the blueprint's emission factor. A
    // differing transportMethodType (e.g. rail) carries a different factor and
    // cannot be summed into one tonne·km value — surface a warning instead.
    const result = aggregateTransportMassDistance(
      [leg(50, 1000), { ...leg(100, 1000), transportMethodType: "rail" }],
      "Feedstock",
    );
    expect(result.massDistanceTonneKm).toBeNull();
    expect(result.warning).toMatch(/mix factor fields/);
  });

  it("handles zero-distance legs cleanly", () => {
    // 0 km × 1 t + 100 km × 1 t = 100 t·km
    const result = aggregateTransportMassDistance(
      [leg(0, 1000), leg(100, 1000)],
      "Feedstock",
    );
    expect(result.massDistanceTonneKm).toBe(100);
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
    totalDieselLitres: 70,
    totalElectricityKwh: 200,
    feedstockTransportMassDistanceTonneKm: null,
    biocharTransportMassDistanceTonneKm: null,
    sampleTransportMassDistanceTonneKm: 0,
    earliestStartTime: new Date("2026-01-01T00:00:00Z"),
    latestEndTime: new Date("2026-01-31T23:59:59Z"),
    sourceProductionRunIds: ["pr_1"],
    warnings: [],
  };

  it("populates all three transport fields with mass-distance (tonne·km)", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [leg(50, 1000), leg(100, 4000)], // 50 + 400 = 450
      biochar: [leg(200, 1000)], // 200
      sample: [leg(10, 500), leg(30, 500)], // 5 + 15 = 20
    });

    expect(enriched.feedstockTransportMassDistanceTonneKm).toBe(450);
    expect(enriched.biocharTransportMassDistanceTonneKm).toBe(200);
    expect(enriched.sampleTransportMassDistanceTonneKm).toBe(20);
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

  it("sample mass-distance is 0 (not null) when there are no sample legs", () => {
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
    expect(baseAgg.feedstockTransportMassDistanceTonneKm).toBeNull();
    expect(enriched.feedstockTransportMassDistanceTonneKm).toBe(50);
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

  it("leaves feedstock/biochar null (fail closed) when those categories have no legs", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [],
      biochar: [leg(100, 1000)], // 100
      sample: [],
    });

    expect(enriched.feedstockTransportMassDistanceTonneKm).toBeNull();
    expect(enriched.biocharTransportMassDistanceTonneKm).toBe(100);
    expect(enriched.sampleTransportMassDistanceTonneKm).toBe(0);
  });

  it("appends a warning per category with a leg missing load mass", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [leg(50, 1000), leg(100, null)],
      biochar: [leg(200, 1000)],
      sample: [leg(10, 500), leg(30, null)],
    });

    expect(enriched.feedstockTransportMassDistanceTonneKm).toBeNull();
    expect(enriched.biocharTransportMassDistanceTonneKm).toBe(200);
    // Blocked sample category falls back to 0 (the pipeline blocks on the
    // warning, not the value).
    expect(enriched.sampleTransportMassDistanceTonneKm).toBe(0);
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

  // §8.6.2 buckets (issue #349, ADR 0020): biochar transport is the DELIVERY
  // bucket and scales with the applied share; feedstock/sample transport are
  // PRODUCTION-bucket and always sum whole.
  it("scales the biochar mass-distance by the applied-biochar fraction", () => {
    const enriched = enrichWithTransportLegs(
      baseAgg,
      {
        feedstock: [],
        biochar: [leg(10, 1000)], // 10 t·km
        sample: [],
      },
      { appliedBiocharFraction: 0.4 },
    );
    expect(enriched.biocharTransportMassDistanceTonneKm).toBeCloseTo(4);
  });

  it("leaves feedstock and sample mass-distance unscaled at a fraction below 1", () => {
    const enriched = enrichWithTransportLegs(
      baseAgg,
      {
        feedstock: [leg(50, 1000)], // 50 t·km
        biochar: [leg(10, 1000)], // 10 t·km
        sample: [leg(10, 500), leg(30, 500)], // 20 t·km
      },
      { appliedBiocharFraction: 0.4 },
    );
    // PRODUCTION-bucket categories stay whole.
    expect(enriched.feedstockTransportMassDistanceTonneKm).toBe(50);
    expect(enriched.sampleTransportMassDistanceTonneKm).toBe(20);
    // Only the DELIVERY-bucket biochar category scales.
    expect(enriched.biocharTransportMassDistanceTonneKm).toBeCloseTo(4);
  });

  it("defaults to the full biochar mass-distance when no option is passed", () => {
    const enriched = enrichWithTransportLegs(baseAgg, {
      feedstock: [],
      biochar: [leg(10, 1000)],
      sample: [],
    });
    expect(enriched.biocharTransportMassDistanceTonneKm).toBe(10);
  });

  it("clamps an out-of-range applied-biochar fraction into [0, 1]", () => {
    const legs = {
      feedstock: [],
      biochar: [leg(10, 1000)], // 10 t·km
      sample: [],
    };
    const above = enrichWithTransportLegs(baseAgg, legs, {
      appliedBiocharFraction: 1.5,
    });
    expect(above.biocharTransportMassDistanceTonneKm).toBe(10);
    const below = enrichWithTransportLegs(baseAgg, legs, {
      appliedBiocharFraction: -0.5,
    });
    expect(below.biocharTransportMassDistanceTonneKm).toBe(0);
  });

  it("keeps a null biochar mass-distance null under a fraction", () => {
    const enriched = enrichWithTransportLegs(
      baseAgg,
      {
        feedstock: [leg(50, 1000)],
        biochar: [], // no legs ⇒ null (fails closed at submit)
        sample: [],
      },
      { appliedBiocharFraction: 0.4 },
    );
    expect(enriched.biocharTransportMassDistanceTonneKm).toBeNull();
  });
});
