import { describe, expect, it } from "vitest";
import { GEOJSON_MAX_FEATURES } from "@/config/geo";
import { normalizeGeoJson } from "./normalize";

const RING_2D = [
  [37.42, -3.25],
  [37.43, -3.25],
  [37.43, -3.24],
  [37.42, -3.24],
  [37.42, -3.25],
];

function normalize(value: unknown, source: "upload" | "paste" = "paste") {
  return normalizeGeoJson({
    text: JSON.stringify(value),
    source,
    fileName: source === "upload" ? "field.geojson" : undefined,
  });
}

function polygonFeature(
  coordinates: number[][] = RING_2D,
  properties: Record<string, unknown> = {},
) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
}

function expectBoundary(result: ReturnType<typeof normalize>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.boundary;
}

function signedRingArea(ring: number[][]): number {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area +=
      ring[index][0] * ring[index + 1][1] -
      ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

describe("normalizeGeoJson", () => {
  it("coerces a bare Polygon geometry", () => {
    const boundary = expectBoundary(
      normalize({ type: "Polygon", coordinates: [RING_2D] }),
    );

    expect(boundary.collection.type).toBe("FeatureCollection");
    expect(boundary.collection.features).toHaveLength(1);
    expect(boundary.collection.features[0].geometry.type).toBe("Polygon");
  });

  it("coerces a single Feature", () => {
    const boundary = expectBoundary(normalize(polygonFeature()));

    expect(boundary.stats.features).toBe(1);
    expect(boundary.stats.vertices).toBe(5);
  });

  it("normalizes an Isometric-shaped FeatureCollection", () => {
    const boundary = expectBoundary(
      normalize({
        type: "FeatureCollection",
        features: [
          polygonFeature(RING_2D, {
            name: "Kilema north",
            description: "Storage site boundary",
            reference_id: "KILEMA-N-12",
          }),
        ],
      }),
    );

    expect(boundary.collection.features[0].properties).toEqual({
      name: "Kilema north",
      description: "Storage site boundary",
      reference_id: "KILEMA-N-12",
    });
    expect(boundary.stats.areaHectares).toBeGreaterThan(0);
  });

  it("rejects a self-intersecting ring that encloses no area", () => {
    const bowTie = [
      [37.42, -3.25],
      [37.43, -3.24],
      [37.43, -3.25],
      [37.42, -3.24],
      [37.42, -3.25],
    ];
    const result = normalize({
      type: "FeatureCollection",
      features: [polygonFeature(bowTie)],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a rejection");
    expect(result.error).toMatch(/encloses no area/);
  });

  it("rejects a collinear ring that encloses no area", () => {
    const collinear = [
      [37.42, -3.25],
      [37.43, -3.25],
      [37.44, -3.25],
      [37.42, -3.25],
    ];
    const result = normalize({
      type: "FeatureCollection",
      features: [polygonFeature(collinear)],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a rejection");
    expect(result.error).toMatch(/encloses no area/);
  });

  it("drops source properties that are not on the allow list", () => {
    const boundary = expectBoundary(
      normalize({
        type: "FeatureCollection",
        features: [
          polygonFeature(RING_2D, {
            name: "Kilema north",
            owner_name: "A landowner",
            owner_phone: "+255 700 000 000",
            tenancy_notes: "Leased through 2030",
          }),
        ],
      }),
    );

    expect(boundary.collection.features[0].properties).toEqual({
      name: "Kilema north",
    });
  });

  it("flattens a GeometryCollection and carries parent properties", () => {
    const boundary = expectBoundary(
      normalize({
        type: "Feature",
        properties: { name: "Two plots" },
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Polygon", coordinates: [RING_2D] },
            {
              type: "Polygon",
              coordinates: [
                RING_2D.map(([longitude, latitude]) => [
                  longitude + 0.02,
                  latitude,
                ]),
              ],
            },
          ],
        },
      }),
    );

    expect(boundary.collection.features).toHaveLength(2);
    expect(boundary.collection.features[1].properties).toEqual({
      name: "Two plots",
    });
    expect(boundary.notes).toContain(
      "Flattened 2 geometries from a GeometryCollection.",
    );
  });

  it("rejects a nested FeatureCollection", () => {
    const result = normalize({
      type: "FeatureCollection",
      features: [{ type: "FeatureCollection", features: [] }],
    });

    expect(result.ok).toBe(false);
  });

  it("strips elevation from 3D positions", () => {
    const boundary = expectBoundary(
      normalize(
        polygonFeature(
          RING_2D.map(([longitude, latitude]) => [
            longitude,
            latitude,
            1200,
          ]),
        ),
      ),
    );
    const feature = boundary.collection.features[0];

    expect(feature.geometry.coordinates[0][0]).toHaveLength(2);
    expect(boundary.notes).toContain(
      "Removed elevation values because the boundary map is two dimensional.",
    );
  });

  it("strips a legacy EPSG:4326 declaration", () => {
    const boundary = expectBoundary(
      normalize({
        type: "FeatureCollection",
        crs: {
          type: "name",
          properties: { name: "urn:ogc:def:crs:EPSG::4326" },
        },
        features: [polygonFeature()],
      }),
    );

    expect(boundary.collection).not.toHaveProperty("crs");
    expect(boundary.notes).toContain(
      "Removed the legacy WGS 84 coordinate system declaration.",
    );
  });

  it("rejects a legacy EPSG:3857 declaration", () => {
    const result = normalize({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "EPSG:3857" } },
      features: [polygonFeature()],
    });

    expect(result).toMatchObject({
      ok: false,
      error:
        "This file declares coordinate system EPSG:3857. Re-export it in WGS 84 (EPSG:4326).",
    });
  });

  it("rejects a crs member it cannot name", () => {
    const result = normalize({
      type: "FeatureCollection",
      crs: { type: "link", properties: { href: "http://example.test/crs" } },
      features: [polygonFeature()],
    });

    expect(result).toMatchObject({
      ok: false,
      error:
        "This file declares a coordinate system that is not WGS 84. Re-export it in WGS 84 (EPSG:4326).",
    });
  });

  // RFC 7946 section 3.1.1 caps a position at three elements. check-geojson
  // catches this in the structural pass, so the message is its wording, not
  // ours; the range pass keeps its own guard for shapes that skip that pass.
  it("rejects positions carrying a fourth value", () => {
    const result = normalize(
      polygonFeature(
        RING_2D.map(([longitude, latitude]) => [
          longitude,
          latitude,
          1200,
          42,
        ]),
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("2 or 3 elements");
    }
  });

  it("rejects a latitude-first shape instead of swapping it", () => {
    const result = normalize(
      polygonFeature([
        [-3.25, 137.42],
        [-3.25, 137.43],
        [-3.24, 137.43],
        [-3.24, 137.42],
        [-3.25, 137.42],
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("latitude before longitude");
  });

  it("rejects projected metre coordinates", () => {
    const result = normalize(
      polygonFeature([
        [4_165_000, -360_000],
        [4_166_000, -360_000],
        [4_166_000, -359_000],
        [4_165_000, -359_000],
        [4_165_000, -360_000],
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("projected coordinates");
  });

  it("rejects an empty FeatureCollection", () => {
    expect(
      normalize({ type: "FeatureCollection", features: [] }),
    ).toMatchObject({
      ok: false,
      error: "The file contains no area geometry.",
    });
  });

  it("rejects a collection containing only null geometry", () => {
    expect(
      normalize({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: null },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: "The file contains no area geometry.",
    });
  });

  it("rejects a Point-only file", () => {
    expect(
      normalize({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [37.42, -3.25] },
      }),
    ).toMatchObject({
      ok: false,
      error: "The file contains no area geometry.",
    });
  });

  it("rejects an unclosed ring with character offsets", () => {
    const result = normalize(
      polygonFeature([
        [37.42, -3.25],
        [37.43, -3.25],
        [37.43, -3.24],
        [37.42, -3.24],
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.location?.from).toEqual(expect.any(Number));
      expect(result.location?.to).toEqual(expect.any(Number));
    }
  });

  it("rewinds an exterior ring counterclockwise", () => {
    const clockwiseRing = [...RING_2D].reverse();
    const boundary = expectBoundary(normalize(polygonFeature(clockwiseRing)));
    const feature = boundary.collection.features[0];
    if (feature.geometry.type !== "Polygon") {
      throw new Error("Expected a Polygon");
    }

    expect(signedRingArea(feature.geometry.coordinates[0])).toBeGreaterThan(0);
  });

  it("recomputes a supplied bbox", () => {
    const boundary = expectBoundary(
      normalize({
        type: "FeatureCollection",
        bbox: [0, 0, 1, 1],
        features: [polygonFeature()],
      }),
    );

    expect(boundary.collection.bbox).toEqual([
      37.42,
      -3.25,
      37.43,
      -3.24,
    ]);
    expect(boundary.stats.bbox).toEqual(boundary.collection.bbox);
  });

  it("rejects a collection over the feature cap", () => {
    const result = normalize({
      type: "FeatureCollection",
      features: Array.from(
        { length: GEOJSON_MAX_FEATURES + 1 },
        (_, index) =>
          polygonFeature(
            RING_2D.map(([longitude, latitude]) => [
              longitude + index * 0.00001,
              latitude,
            ]),
          ),
      ),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`${GEOJSON_MAX_FEATURES + 1} areas`);
      expect(result.error).toContain(`maximum is ${GEOJSON_MAX_FEATURES}`);
    }
  });
});
