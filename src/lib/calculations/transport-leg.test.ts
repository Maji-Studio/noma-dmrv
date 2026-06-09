import { describe, expect, it } from "vitest";
import {
  aggregateDistributionLegs,
  deriveTransportLeg,
  isDerivedLegPersistable,
  type DistributionLegRow,
} from "./transport-leg";

function row(
  loadMassKg: number | null,
  distanceKm: number | null,
  locationName: string | null = null,
  gps: [number, number] | null = null,
): DistributionLegRow {
  return {
    loadMassKg,
    distanceKm,
    locationName,
    locationGpsLatitude: gps?.[0] ?? null,
    locationGpsLongitude: gps?.[1] ?? null,
  };
}

describe("deriveTransportLeg", () => {
  const origin = { name: "Acme Forestry", gpsLatitude: 51.5, gpsLongitude: -0.12 };
  const destination = { name: "Plant A", gpsLatitude: 51.6, gpsLongitude: -0.1 };
  const vehicle = { vehicleType: "HGV rigid", modelYear: 2021 };

  it("derives route names/GPS from origin and destination", () => {
    const leg = deriveTransportLeg({
      origin, destination, vehicle, loadMassKg: 1500, storedDistanceKm: 40,
    });
    expect(leg.originName).toBe("Acme Forestry");
    expect(leg.destinationName).toBe("Plant A");
    expect(leg.originGpsLatitude).toBe(51.5);
    expect(leg.destinationGpsLongitude).toBe(-0.1);
    expect(leg.transportMethodType).toBe("road");
    expect(leg.calculationMethodType).toBe("distance_based");
    expect(leg.vehicleType).toBe("HGV rigid");
    expect(leg.modelYear).toBe(2021);
  });

  it("uses the stored distance when no override is given", () => {
    const leg = deriveTransportLeg({
      origin, destination, vehicle, loadMassKg: 1500, storedDistanceKm: 40,
    });
    expect(leg.distanceKm).toBe(40);
  });

  it("override wins over the stored distance", () => {
    const leg = deriveTransportLeg({
      origin, destination, vehicle, loadMassKg: 1500,
      storedDistanceKm: 40, distanceKmOverride: 62,
    });
    expect(leg.distanceKm).toBe(62);
  });

  it("ignores a non-positive override and falls back to stored", () => {
    const leg = deriveTransportLeg({
      origin, destination, vehicle, loadMassKg: 1500,
      storedDistanceKm: 40, distanceKmOverride: 0,
    });
    expect(leg.distanceKm).toBe(40);
  });

  it("carries cargo (load) mass through unchanged", () => {
    const leg = deriveTransportLeg({
      origin, destination, vehicle, loadMassKg: 7200, storedDistanceKm: 40,
    });
    expect(leg.loadMassKg).toBe(7200);
  });

  it("reports missing distance and load mass without throwing", () => {
    const leg = deriveTransportLeg({
      origin: null, destination: null, vehicle: null,
      loadMassKg: null, storedDistanceKm: null,
    });
    expect(leg.distanceKm).toBeNull();
    expect(leg.loadMassKg).toBeNull();
    expect(leg.missing).toContain("distance");
    expect(leg.missing).toContain("load mass");
    expect(isDerivedLegPersistable(leg)).toBe(false);
  });

  it("is persistable once distance and load mass are present", () => {
    const leg = deriveTransportLeg({
      origin, destination, vehicle, loadMassKg: 1500, storedDistanceKm: 40,
    });
    expect(leg.missing).toHaveLength(0);
    expect(isDerivedLegPersistable(leg)).toBe(true);
  });
});

describe("aggregateDistributionLegs", () => {
  it("passes a single delivery straight through", () => {
    const agg = aggregateDistributionLegs([row(250, 40, "Plot A", [-6.84, 39.31])]);
    expect(agg.totalMassKg).toBe(250);
    expect(agg.weightedDistanceKm).toBe(40);
    expect(agg.destinationName).toBe("Plot A");
    expect(agg.destinationGpsLatitude).toBe(-6.84);
    expect(agg.destinationGpsLongitude).toBe(39.31);
  });

  it("mass-weights distance so avgDist × totalMass === Σ(distⱼ·massⱼ)", () => {
    const rows = [row(100, 30), row(300, 50)];
    const agg = aggregateDistributionLegs(rows);
    const exactProduct = 100 * 30 + 300 * 50; // 16500 kg·km
    expect(agg.totalMassKg).toBe(400);
    // (100·30 + 300·50) / 400 = 45
    expect(agg.weightedDistanceKm).toBe(45);
    expect(agg.weightedDistanceKm! * agg.totalMassKg).toBe(exactProduct);
  });

  it("skips deliveries missing a positive mass or distance", () => {
    const agg = aggregateDistributionLegs([
      row(250, 40, "Plot A"),
      row(null, 40, "Plot B"), // no mass → skipped
      row(100, null, "Plot C"), // no distance → skipped
      row(0, 40, "Plot D"), // zero mass → skipped
    ]);
    expect(agg.totalMassKg).toBe(250);
    expect(agg.weightedDistanceKm).toBe(40);
    expect(agg.destinationName).toBe("Plot A");
  });

  it("labels multiple destinations generically and drops single GPS", () => {
    const agg = aggregateDistributionLegs([
      row(100, 20, "Plot A", [1, 2]),
      row(100, 60, "Plot B", [3, 4]),
    ]);
    expect(agg.totalMassKg).toBe(200);
    expect(agg.weightedDistanceKm).toBe(40);
    expect(agg.destinationName).toBe("Customer sites");
    expect(agg.destinationGpsLatitude).toBeNull();
    expect(agg.destinationGpsLongitude).toBeNull();
  });

  it("returns an empty, non-persistable aggregate when nothing qualifies", () => {
    const agg = aggregateDistributionLegs([row(null, null), row(0, 10)]);
    expect(agg.totalMassKg).toBe(0);
    expect(agg.weightedDistanceKm).toBeNull();
    expect(agg.destinationName).toBeNull();
  });
});
