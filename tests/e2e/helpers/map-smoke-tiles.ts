/**
 * Fixture basemap for tests/e2e/map-smoke.spec.ts: a MapLibre style with one
 * vector source, and a Mapbox Vector Tile (spec v2) that the spec serves for
 * every z/x/y. The tile is encoded here by hand so the fixture is readable
 * and needs no extra dependency: one layer holding one polygon that covers
 * the whole tile.
 */

import { MAP_SMOKE_TILE_URL_TEMPLATE } from "@/app/e2e/map-smoke/map-smoke-fixture";

export const MAP_SMOKE_SOURCE_LAYER = "land";

const MVT_VERSION = 2;
const MVT_EXTENT = 4096;
const SOURCE_MAX_ZOOM = 14;

// Protobuf wire types.
const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

// Field numbers from vector_tile.proto.
const TILE_LAYERS = 3;
const LAYER_NAME = 1;
const LAYER_FEATURES = 2;
const LAYER_EXTENT = 5;
const LAYER_VERSION = 15;
const FEATURE_TYPE = 3;
const FEATURE_GEOMETRY = 4;
const GEOM_TYPE_POLYGON = 3;

// Geometry command ids.
const CMD_MOVE_TO = 1;
const CMD_LINE_TO = 2;
const CMD_CLOSE_PATH = 7;

const VARINT_PAYLOAD_BITS = 7;
const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_CONTINUE = 0x80;
const TAG_SHIFT = 3;
const COMMAND_COUNT_SHIFT = 3;

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest > VARINT_PAYLOAD_MASK) {
    bytes.push((rest & VARINT_PAYLOAD_MASK) | VARINT_CONTINUE);
    rest >>>= VARINT_PAYLOAD_BITS;
  }
  bytes.push(rest);
  return bytes;
}

const zigzag = (n: number) => (n << 1) ^ (n >> 31);
const tag = (field: number, wireType: number) =>
  varint((field << TAG_SHIFT) | wireType);
const command = (id: number, count: number) => (count << COMMAND_COUNT_SHIFT) | id;

function varintField(field: number, value: number): number[] {
  return [...tag(field, WIRE_VARINT), ...varint(value)];
}

function bytesField(field: number, payload: number[]): number[] {
  return [...tag(field, WIRE_LENGTH_DELIMITED), ...varint(payload.length), ...payload];
}

/** Clockwise ring (exterior in tile space, y down) around the full extent. */
function fullExtentSquareGeometry(): number[] {
  const deltas: Array<[number, number]> = [
    [MVT_EXTENT, 0],
    [0, MVT_EXTENT],
    [-MVT_EXTENT, 0],
  ];
  return [
    command(CMD_MOVE_TO, 1),
    zigzag(0),
    zigzag(0),
    command(CMD_LINE_TO, deltas.length),
    ...deltas.flatMap(([dx, dy]) => [zigzag(dx), zigzag(dy)]),
    command(CMD_CLOSE_PATH, 1),
  ];
}

/** Encoded tile: one `land` layer with one polygon covering the tile. */
export function fullExtentVectorTile(): Buffer {
  const geometry = fullExtentSquareGeometry().flatMap(varint);
  const feature = [
    ...varintField(FEATURE_TYPE, GEOM_TYPE_POLYGON),
    ...bytesField(FEATURE_GEOMETRY, geometry),
  ];
  const layer = [
    ...varintField(LAYER_VERSION, MVT_VERSION),
    ...bytesField(LAYER_NAME, [...Buffer.from(MAP_SMOKE_SOURCE_LAYER, "utf8")]),
    ...bytesField(LAYER_FEATURES, feature),
    ...varintField(LAYER_EXTENT, MVT_EXTENT),
  ];
  return Buffer.from(bytesField(TILE_LAYERS, layer));
}

/** Style with no glyphs or sprite: a background and one vector fill layer. */
export function mapSmokeStyle() {
  return {
    version: 8,
    sources: {
      fixture: {
        type: "vector",
        tiles: [MAP_SMOKE_TILE_URL_TEMPLATE],
        maxzoom: SOURCE_MAX_ZOOM,
      },
    },
    layers: [
      { id: "background", type: "background" },
      {
        id: MAP_SMOKE_SOURCE_LAYER,
        type: "fill",
        source: "fixture",
        "source-layer": MAP_SMOKE_SOURCE_LAYER,
      },
    ],
  };
}
