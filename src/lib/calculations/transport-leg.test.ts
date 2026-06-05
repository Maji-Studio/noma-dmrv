import { describe, expect, it } from "vitest";
import {
  deriveTransportLeg,
  isDerivedLegPersistable,
} from "./transport-leg";

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
