import { area } from "@turf/area";
import { bbox } from "@turf/bbox";
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type {
  GisBoundaryBbox,
  GisBoundaryCenter,
  GisBoundaryFeature,
  GisBoundaryProperties,
} from "./types";

/** turf reports area in square metres; boundaries read in hectares. */
const SQUARE_METRES_PER_HECTARE = 10_000;

export interface GisBoundaryStats {
  features: number;
  vertices: number;
  areaHectares: number;
  bbox: GisBoundaryBbox;
  center: GisBoundaryCenter;
}

/** Visit every `[lon, lat]` position in an arbitrarily nested coordinate array. */
export function forEachPosition(
  value: unknown,
  visit: (position: Position) => void,
): void {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((entry) => typeof entry === "number")
  ) {
    visit(value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    forEachPosition(entry, visit);
  }
}

export function countBoundaryVertices(
  features: readonly GisBoundaryFeature[],
): number {
  let vertices = 0;
  for (const feature of features) {
    forEachPosition(feature.geometry.coordinates, () => {
      vertices += 1;
    });
  }
  return vertices;
}

/**
 * Derive every reported boundary measurement from the geometry itself.
 *
 * Extent, centre and area are never read from a caller-supplied envelope: the
 * summary card, the preview map and the certification record all render from
 * these numbers, so they are recomputed on the server from the coordinates that
 * are actually stored.
 */
export function computeBoundaryStats(
  features: readonly GisBoundaryFeature[],
): GisBoundaryStats {
  const collection: FeatureCollection<
    Polygon | MultiPolygon,
    GisBoundaryProperties
  > = {
    type: "FeatureCollection",
    features: features as GisBoundaryFeature[],
  };
  const extent = bbox(collection, { recompute: true }) as GisBoundaryBbox;

  return {
    features: features.length,
    vertices: countBoundaryVertices(features),
    areaHectares: area(collection) / SQUARE_METRES_PER_HECTARE,
    bbox: extent,
    center: [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2],
  };
}
