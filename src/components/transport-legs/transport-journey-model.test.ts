import { describe, expect, it } from "vitest";
import { buildJourney, type JourneyLegInput } from "./transport-journey-model";

function leg(patch: Partial<JourneyLegInput> = {}): JourneyLegInput {
  return {
    originName: "Supplier yard",
    destinationName: "Plant",
    distanceKm: 15,
    distanceSource: "manual",
    transportMethodType: "road",
    loadMassKg: 2000,
    ...patch,
  };
}

describe("buildJourney", () => {
  it("counts each leg's round trip next to the one-way distance it records", () => {
    const [only] = buildJourney([leg()]).legs;

    expect(only.oneWayKm).toBe(15);
    expect(only.countedKm).toBe(30);
    expect(only.sourceLabel).toBe("Manual entry");
  });

  it("puts a single leg's load on the leg and leaves nothing to total", () => {
    const journey = buildJourney([leg()]);

    expect(journey.loadOnLegs).toBe(true);
    expect(journey.sharedLoadKg).toBeNull();
    expect(journey.totalCountedKm).toBe(30);
  });

  it("reads one shared load under the total when several legs move the same cargo", () => {
    const journey = buildJourney([
      leg(),
      leg({ originName: "Plant", destinationName: "Field", distanceKm: 100 }),
    ]);

    expect(journey.loadOnLegs).toBe(false);
    expect(journey.sharedLoadKg).toBe(2000);
    expect(journey.totalCountedKm).toBe(230);
  });

  it("names each leg's load when the loads differ or one is missing", () => {
    expect(
      buildJourney([leg(), leg({ originName: "Plant", loadMassKg: 500 })]).loadOnLegs,
    ).toBe(true);
    expect(
      buildJourney([leg(), leg({ originName: "Plant", loadMassKg: null })]).loadOnLegs,
    ).toBe(true);
  });

  it("drops the load entirely for a route before goods move", () => {
    const journey = buildJourney([leg()], { hideLoad: true });

    expect(journey.legs[0].loadKg).toBeNull();
    expect(journey.loadOnLegs).toBe(false);
    expect(journey.sharedLoadKg).toBeNull();
  });

  it("shares a stop only when a leg departs where the previous one arrived", () => {
    const chained = buildJourney([
      leg(),
      leg({ originName: " plant ", destinationName: "Field" }),
    ]);
    const broken = buildJourney([
      leg(),
      leg({ originName: "Depot", destinationName: "Field" }),
    ]);

    expect(chained.legs.map((l) => l.startsNewStop)).toEqual([true, false]);
    expect(broken.legs.map((l) => l.startsNewStop)).toEqual([true, true]);
  });

  it("never merges two unnamed stops without coordinates", () => {
    const journey = buildJourney([
      leg({ destinationName: null }),
      leg({ originName: null }),
    ]);

    expect(journey.legs[1].startsNewStop).toBe(true);
  });

  it("matches unnamed stops by their coordinates", () => {
    const journey = buildJourney([
      leg({ destinationName: null, destinationGpsLatitude: -8.3, destinationGpsLongitude: 35.28 }),
      leg({ originName: null, originGpsLatitude: -8.3, originGpsLongitude: 35.28 }),
    ]);

    expect(journey.legs[1].startsNewStop).toBe(false);
  });

  it("counts legs without a distance so the total is never read as complete", () => {
    const journey = buildJourney([leg(), leg({ originName: "Plant", distanceKm: null })]);

    expect(journey.missingDistances).toBe(1);
    expect(journey.totalCountedKm).toBe(30);
    expect(journey.legs[1].countedKm).toBeNull();
  });

  it("keeps each end's coordinates for the route map", () => {
    const [only] = buildJourney([
      leg({
        originGpsLatitude: -8.32,
        originGpsLongitude: 35.29,
        destinationGpsLatitude: -8.3,
        destinationGpsLongitude: 35.28,
      }),
    ]).legs;

    expect(only.originPoint).toEqual({ lat: -8.32, lng: 35.29 });
    expect(only.destinationPoint).toEqual({ lat: -8.3, lng: 35.28 });
  });
});
