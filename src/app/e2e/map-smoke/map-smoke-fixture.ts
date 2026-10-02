/**
 * Fixture shared by the map smoke page and tests/e2e/map-smoke.spec.ts.
 *
 * The `.invalid` TLD never resolves (RFC 2606), so only the spec's
 * `page.route` interception can answer these URLs: the page stays hermetic
 * and never reaches MapTiler.
 */

import type { GisBoundaryBbox, GisBoundaryCollection } from "@/lib/geojson/types";

export const MAP_SMOKE_FIXTURE_ORIGIN = "https://map-smoke.e2e.invalid";
export const MAP_SMOKE_STYLE_URL = `${MAP_SMOKE_FIXTURE_ORIGIN}/style.json`;
export const MAP_SMOKE_TILE_URL_TEMPLATE = `${MAP_SMOKE_FIXTURE_ORIGIN}/tiles/{z}/{x}/{y}.pbf`;

// A small square plot near the default map centre (central Tanzania).
const WEST = 35.7;
const SOUTH = -6.2;
const EAST = 35.8;
const NORTH = -6.1;

export const MAP_SMOKE_BBOX: GisBoundaryBbox = [WEST, SOUTH, EAST, NORTH];

export const MAP_SMOKE_BOUNDARY: GisBoundaryCollection = {
  type: "FeatureCollection",
  bbox: MAP_SMOKE_BBOX,
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [WEST, SOUTH],
            [EAST, SOUTH],
            [EAST, NORTH],
            [WEST, NORTH],
            [WEST, SOUTH],
          ],
        ],
      },
    },
  ],
};
