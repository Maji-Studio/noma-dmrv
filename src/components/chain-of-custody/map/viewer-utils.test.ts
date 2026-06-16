import { describe, expect, it } from "vitest";
import type {
  ChainGeoLeg,
  ChainOfCustodyGeoData,
} from "@/data-access/chain-of-custody-geo";
import {
  bowedArc,
  chipAnchor,
  legLineCoordinates,
  resolveLegEndpoints,
  totalLegDistanceKm,
} from "./viewer-utils";

const FACILITY = { lat: -6.163, lng: 35.7516 };
const SUPPLIER = { lat: -6.8, lng: 39.28 };
const FIELD = { lat: -6.75, lng: 39.2 };

function leg(overrides: Partial<ChainGeoLeg>): ChainGeoLeg {
  return {
    id: "leg-1",
    kind: "inbound",
    entityType: "feedstock",
    entityId: "feedstock-1",
    originName: null,
    originLat: null,
    originLng: null,
    destinationName: null,
    destinationLat: null,
    destinationLng: null,
    distanceKm: 10,
    distanceSource: null,
    isDerived: true,
    loadMassKg: null,
    materialLabel: null,
    outerHref: null,
    outerCode: null,
    ...overrides,
  };
}

function geo(overrides: Partial<ChainOfCustodyGeoData>): ChainOfCustodyGeoData {
  return {
    facility: { id: "fac-1", code: "FAC-1", name: "Facility", ...FACILITY },
    nodes: [],
    legs: [],
    warnings: [],
    ...overrides,
  };
}

describe("resolveLegEndpoints", () => {
  it("uses the leg's own stored endpoints when present", () => {
    const data = geo({
      legs: [
        leg({
          originLat: SUPPLIER.lat,
          originLng: SUPPLIER.lng,
          destinationLat: FACILITY.lat,
          destinationLng: FACILITY.lng,
        }),
      ],
    });
    const { plottable, unplottable } = resolveLegEndpoints(data);
    expect(unplottable).toHaveLength(0);
    expect(plottable[0].origin).toEqual(SUPPLIER);
    expect(plottable[0].destination).toEqual(FACILITY);
  });

  it("falls back to the feedstock node position and the facility for inbound legs", () => {
    const data = geo({
      nodes: [
        {
          id: "feedstock:feedstock-1",
          kind: "feedstock",
          entityId: "feedstock-1",
          code: "FS-1",
          lat: SUPPLIER.lat,
          lng: SUPPLIER.lng,
          positionSource: "own",
          inheritedFromFacility: false,
          sub: null,
        },
      ],
      legs: [leg({})],
    });
    const { plottable } = resolveLegEndpoints(data);
    expect(plottable[0].origin).toEqual(SUPPLIER);
    expect(plottable[0].destination).toEqual(FACILITY);
  });

  it("never anchors a leg on a facility-inherited node position", () => {
    const data = geo({
      nodes: [
        {
          id: "feedstock:feedstock-1",
          kind: "feedstock",
          entityId: "feedstock-1",
          code: "FS-1",
          lat: FACILITY.lat,
          lng: FACILITY.lng,
          positionSource: "facility",
          inheritedFromFacility: true,
          sub: null,
        },
      ],
      legs: [leg({})],
    });
    const { plottable, unplottable } = resolveLegEndpoints(data);
    expect(plottable).toHaveLength(0);
    expect(unplottable).toHaveLength(1);
  });

  it("resolves outbound legs facility → application", () => {
    const data = geo({
      nodes: [
        {
          id: "application:app-1",
          kind: "application",
          entityId: "app-1",
          code: "AP-1",
          lat: FIELD.lat,
          lng: FIELD.lng,
          positionSource: "own",
          inheritedFromFacility: false,
          sub: null,
        },
      ],
      legs: [leg({ id: "leg-out", kind: "outbound", entityType: "biochar", entityId: "bp-1" })],
    });
    const { plottable } = resolveLegEndpoints(data);
    expect(plottable[0].origin).toEqual(FACILITY);
    expect(plottable[0].destination).toEqual(FIELD);
  });
});

describe("legLineCoordinates", () => {
  const plottable = { leg: leg({}), origin: SUPPLIER, destination: FACILITY };

  it("prefers resolved road geometry", () => {
    const coords: [number, number][] = [
      [SUPPLIER.lng, SUPPLIER.lat],
      [38.0, -6.5],
      [FACILITY.lng, FACILITY.lat],
    ];
    const result = legLineCoordinates(plottable, { coordinates: coords, distanceKm: 41.5 });
    expect(result.routed).toBe(true);
    expect(result.coordinates).toEqual(coords);
  });

  it("falls back to a bowed arc when no geometry resolved", () => {
    const result = legLineCoordinates(plottable, null);
    expect(result.routed).toBe(false);
    const arc = bowedArc(SUPPLIER, FACILITY);
    expect(result.coordinates).toEqual(arc);
    // Endpoints exact, interior bowed off the straight line.
    expect(arc[0]).toEqual([SUPPLIER.lng, SUPPLIER.lat]);
    expect(arc[arc.length - 1]).toEqual([FACILITY.lng, FACILITY.lat]);
    const midStraight = [(SUPPLIER.lng + FACILITY.lng) / 2, (SUPPLIER.lat + FACILITY.lat) / 2];
    const midArc = arc[Math.floor(arc.length / 2)];
    expect(Math.hypot(midArc[0] - midStraight[0], midArc[1] - midStraight[1])).toBeGreaterThan(0);
  });
});

describe("chipAnchor", () => {
  const coords = bowedArc(SUPPLIER, FACILITY);

  it("staggers neighbouring legs to different points along the line", () => {
    const anchors = [0, 1, 2].map((index) => chipAnchor(coords, index));
    expect(new Set(anchors.map((a) => a.join(","))).size).toBe(3);
    // The stagger cycle repeats after CHIP_STAGGER_STEPS legs.
    expect(chipAnchor(coords, 3)).toEqual(anchors[0]);
  });

  it("clamps to the polyline for tiny geometries", () => {
    const two: [number, number][] = [
      [0, 0],
      [1, 1],
    ];
    expect(two).toContainEqual(chipAnchor(two, 2));
  });
});

describe("totalLegDistanceKm", () => {
  it("sums stored distances at one-decimal precision", () => {
    expect(totalLegDistanceKm([leg({ distanceKm: 41.5 }), leg({ distanceKm: 12.3 })])).toBe(53.8);
    expect(totalLegDistanceKm([])).toBe(0);
  });
});
