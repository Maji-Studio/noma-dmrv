import { describe, expect, it } from "vitest";
import {
  GEOJSON_MAX_FEATURES,
  GEOJSON_MAX_NOTE_LENGTH,
  GEOJSON_MAX_NOTES,
  GEOJSON_MAX_VERTICES,
} from "@/config/geo";
import type { GisBoundary, GisBoundaryFeature } from "@/lib/geojson/types";
import { parseGisBoundary } from "./gis-boundary";

/** A ~1.2 km square near Mount Kilimanjaro, Tanzania. */
const RING = [
  [37.42, -3.25],
  [37.43, -3.25],
  [37.43, -3.24],
  [37.42, -3.24],
  [37.42, -3.25],
];
const TANZANIA_BBOX: [number, number, number, number] = [
  37.42, -3.25, 37.43, -3.24,
];
/** Deliberately nowhere near the geometry: Oregon, USA. */
const OREGON_BBOX: [number, number, number, number] = [
  -123.1, 44.0, -123.0, 44.1,
];

function polygonFeature(ring: number[][] = RING): GisBoundaryFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  } as GisBoundaryFeature;
}

function boundary(overrides: Partial<GisBoundary> = {}): GisBoundary {
  return {
    version: 1,
    source: "paste",
    fileName: null,
    capturedAt: "2026-07-01T00:00:00.000Z",
    collection: {
      type: "FeatureCollection",
      features: [polygonFeature()],
      bbox: TANZANIA_BBOX,
    },
    stats: {
      features: 1,
      vertices: 5,
      areaHectares: 122.5,
      bbox: TANZANIA_BBOX,
      center: [37.425, -3.245],
    },
    notes: [],
    ...overrides,
  } as GisBoundary;
}

describe("parseGisBoundary", () => {
  it("derives the extent, centre and area from the geometry", () => {
    const parsed = parseGisBoundary(boundary());

    expect(parsed.stats.features).toBe(1);
    expect(parsed.stats.vertices).toBe(5);
    expect(parsed.stats.bbox).toEqual(TANZANIA_BBOX);
    expect(parsed.stats.center[0]).toBeCloseTo(37.425, 6);
    expect(parsed.stats.center[1]).toBeCloseTo(-3.245, 6);
    expect(parsed.stats.areaHectares).toBeGreaterThan(0);
  });

  it("overwrites a fabricated extent, centre and area", () => {
    const parsed = parseGisBoundary(
      boundary({
        collection: {
          type: "FeatureCollection",
          features: [polygonFeature()],
          bbox: OREGON_BBOX,
        },
        stats: {
          features: 1,
          vertices: 5,
          areaHectares: 999_999,
          bbox: OREGON_BBOX,
          center: [-123.05, 44.05],
        },
      }),
    );

    expect(parsed.stats.bbox).toEqual(TANZANIA_BBOX);
    expect(parsed.collection.bbox).toEqual(TANZANIA_BBOX);
    expect(parsed.stats.center[0]).toBeCloseTo(37.425, 6);
    expect(parsed.stats.areaHectares).toBeLessThan(1000);
  });

  it("overwrites fabricated feature and vertex counts", () => {
    const parsed = parseGisBoundary(
      boundary({
        stats: {
          features: 42,
          vertices: 9999,
          areaHectares: 122.5,
          bbox: TANZANIA_BBOX,
          center: [37.425, -3.245],
        },
      }),
    );

    expect(parsed.stats.features).toBe(1);
    expect(parsed.stats.vertices).toBe(5);
  });

  it("rejects more features than the cap allows", () => {
    const features = Array.from({ length: GEOJSON_MAX_FEATURES + 1 }, () =>
      polygonFeature(),
    );

    expect(() =>
      parseGisBoundary(
        boundary({
          collection: {
            type: "FeatureCollection",
            features,
            bbox: TANZANIA_BBOX,
          },
        }),
      ),
    ).toThrow(/areas/);
  });

  it("rejects more vertices than the cap allows", () => {
    // One ring per feature, four positions each, just over the vertex cap.
    const positionsPerFeature = RING.length;
    const featureCount =
      Math.ceil(GEOJSON_MAX_VERTICES / positionsPerFeature) + 1;
    const features = Array.from({ length: featureCount }, () =>
      polygonFeature(),
    );

    expect(() =>
      parseGisBoundary(
        boundary({
          collection: {
            type: "FeatureCollection",
            features,
            bbox: TANZANIA_BBOX,
          },
        }),
      ),
    ).toThrow();
  });

  it("rejects a pasted boundary that claims a file name", () => {
    expect(() =>
      parseGisBoundary(boundary({ source: "paste", fileName: "field.geojson" })),
    ).toThrow();
  });

  it("rejects an uploaded boundary with no file name", () => {
    expect(() =>
      parseGisBoundary(boundary({ source: "upload", fileName: null })),
    ).toThrow();
  });

  it("rejects more notes than the cap allows", () => {
    const notes = Array.from({ length: GEOJSON_MAX_NOTES + 1 }, () => "note");

    expect(() => parseGisBoundary(boundary({ notes }))).toThrow();
  });

  it("rejects a note longer than the cap allows", () => {
    const notes = ["x".repeat(GEOJSON_MAX_NOTE_LENGTH + 1)];

    expect(() => parseGisBoundary(boundary({ notes }))).toThrow();
  });

  it("rejects coordinates outside the WGS 84 range", () => {
    expect(() =>
      parseGisBoundary(
        boundary({
          collection: {
            type: "FeatureCollection",
            features: [
              polygonFeature([
                [200, -3.25],
                [201, -3.25],
                [201, -3.24],
                [200, -3.24],
                [200, -3.25],
              ]),
            ],
            bbox: TANZANIA_BBOX,
          },
        }),
      ),
    ).toThrow();
  });
});
