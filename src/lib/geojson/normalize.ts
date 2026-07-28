import { getIssues, scavenge } from "@placemarkio/check-geojson";
import { area } from "@turf/area";
import { bbox } from "@turf/bbox";
import { rewind } from "@turf/rewind";
import { truncate } from "@turf/truncate";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import {
  GEOJSON_COORD_DECIMALS,
  GEOJSON_MAX_FEATURES,
  GEOJSON_MAX_INPUT_BYTES,
  GEOJSON_MAX_NORMALIZED_BYTES,
  GEOJSON_MAX_VERTICES,
  GEOJSON_PROPERTY_BYTE_CAP,
  GEOJSON_PROPERTY_KEY_CAP,
} from "@/config/geo";
import { parseGisBoundary } from "@/schemas/gis-boundary";
import type {
  GisBoundary,
  GisBoundaryBbox,
  GisBoundaryCollection,
  GisBoundaryFeature,
  GisBoundaryProperties,
  NormalizeGeoJsonResult,
} from "./types";

const AREA_GEOMETRY_TYPES = new Set(["Polygon", "MultiPolygon"]);
/** turf reports area in square metres; boundaries read in hectares. */
const SQUARE_METRES_PER_HECTARE = 10_000;
/** Longitude degrees a single field boundary can plausibly span. */
const MAX_LONGITUDE_SPAN_DEGREES = 180;
const PROPERTY_ALLOW_LIST = ["name", "description", "reference_id"] as const;
const WGS84_CRS_PATTERN =
  /(?:EPSG(?::|::|\/)\s*4326|CRS84|WGS\s*84|urn:ogc:def:crs:EPSG:[^:]*:4326)/i;

type AreaGeometry = Polygon | MultiPolygon;
type AreaFeature = GisBoundaryFeature;
type NormalizeGeoJsonFailure = Extract<
  NormalizeGeoJsonResult,
  { ok: false }
>;

interface NormalizeGeoJsonInput {
  text: string;
  source: "upload" | "paste";
  fileName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function structuralError(
  issue: { message: string; from: number; to: number },
): NormalizeGeoJsonFailure {
  return {
    ok: false,
    error: `The GeoJSON structure is not valid. ${issue.message}`,
    location: { from: issue.from, to: issue.to },
  };
}

/**
 * Read the legacy 2008-spec `crs` member. `present: false` means the file makes
 * no claim, which RFC 7946 section 4 says to read as WGS 84. A `crs` we cannot
 * name is still a claim, so it is reported without a name rather than ignored.
 */
function readDeclaredCrs(
  root: Record<string, unknown>,
): { present: boolean; name: string | null } {
  if (!("crs" in root)) return { present: false, name: null };
  const crs = root.crs;
  if (
    isRecord(crs) &&
    isRecord(crs.properties) &&
    typeof crs.properties.name === "string"
  ) {
    return { present: true, name: crs.properties.name };
  }
  return { present: true, name: null };
}

function collectGeometryFeatures(
  geometry: Geometry,
  properties: GeoJsonProperties,
  features: Feature<Geometry>[],
): number {
  if (geometry.type !== "GeometryCollection") {
    features.push({
      type: "Feature",
      geometry,
      properties: isRecord(properties) ? properties : {},
    });
    return 0;
  }

  let flattened = 0;
  for (const member of geometry.geometries) {
    flattened +=
      1 + collectGeometryFeatures(member, properties, features);
  }
  return flattened;
}

function coerceFeatureCollection(
  value: Record<string, unknown>,
): {
  collection: FeatureCollection;
  flattenedGeometryCount: number;
} | NormalizeGeoJsonFailure {
  if (value.type === "FeatureCollection") {
    const features = value.features as unknown[];
    if (
      features.some(
        (feature) => isRecord(feature) && feature.type === "FeatureCollection",
      )
    ) {
      return {
        ok: false,
        error:
          "A FeatureCollection cannot contain another FeatureCollection. Export one flat FeatureCollection and try again.",
      };
    }

    const collected: Feature<Geometry>[] = [];
    let flattenedGeometryCount = 0;
    for (const rawFeature of features) {
      const feature = rawFeature as Feature;
      if (feature.geometry?.type === "GeometryCollection") {
        flattenedGeometryCount += collectGeometryFeatures(
          feature.geometry,
          feature.properties,
          collected,
        );
      } else {
        collected.push(feature as Feature<Geometry>);
      }
    }
    return {
      collection: { type: "FeatureCollection", features: collected },
      flattenedGeometryCount,
    };
  }

  if (value.type === "Feature") {
    const feature = value as unknown as Feature;
    if (feature.geometry?.type === "GeometryCollection") {
      const features: Feature<Geometry>[] = [];
      const flattenedGeometryCount = collectGeometryFeatures(
        feature.geometry,
        feature.properties,
        features,
      );
      return {
        collection: { type: "FeatureCollection", features },
        flattenedGeometryCount,
      };
    }
    return {
      collection: {
        type: "FeatureCollection",
        features: [feature as Feature<Geometry>],
      },
      flattenedGeometryCount: 0,
    };
  }

  const geometry = value as unknown as Geometry;
  if (geometry.type === "GeometryCollection") {
    const features: Feature<Geometry>[] = [];
    const flattenedGeometryCount = collectGeometryFeatures(
      geometry,
      {},
      features,
    );
    return {
      collection: { type: "FeatureCollection", features },
      flattenedGeometryCount,
    };
  }

  return {
    collection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry,
        },
      ],
    },
    flattenedGeometryCount: 0,
  };
}

function forEachPosition(
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

function countVertices(features: readonly AreaFeature[]): number {
  let vertices = 0;
  for (const feature of features) {
    forEachPosition(feature.geometry.coordinates, () => {
      vertices += 1;
    });
  }
  return vertices;
}

function plural(count: number, singular: string, pluralValue?: string): string {
  return count === 1 ? singular : (pluralValue ?? `${singular}s`);
}

function normalizeProperties(
  properties: GeoJsonProperties,
): { properties: GisBoundaryProperties; dropped: number } {
  if (!isRecord(properties)) return { properties: {}, dropped: 0 };

  const normalized: GisBoundaryProperties = {};
  const retainedKeys = new Set<string>();
  let dropped = 0;
  for (const key of PROPERTY_ALLOW_LIST) {
    if (!(key in properties)) continue;
    retainedKeys.add(key);
    const candidate = { ...normalized, [key]: properties[key] };
    if (
      Object.keys(candidate).length > GEOJSON_PROPERTY_KEY_CAP ||
      serializedBytes(candidate) > GEOJSON_PROPERTY_BYTE_CAP
    ) {
      dropped += 1;
      continue;
    }
    normalized[key] = properties[key];
  }

  for (const [key, value] of Object.entries(properties)) {
    if (retainedKeys.has(key)) continue;
    if (Object.keys(normalized).length >= GEOJSON_PROPERTY_KEY_CAP) {
      dropped += 1;
      continue;
    }
    const candidate = { ...normalized, [key]: value };
    if (serializedBytes(candidate) > GEOJSON_PROPERTY_BYTE_CAP) {
      dropped += 1;
      continue;
    }
    normalized[key] = value;
  }

  return { properties: normalized, dropped };
}

function normalizeAreaFeatures(
  features: readonly Feature[],
  notes: string[],
): AreaFeature[] {
  let nullGeometryCount = 0;
  const droppedTypes = new Map<string, number>();
  const areas: AreaFeature[] = [];
  let droppedPropertyCount = 0;

  for (const feature of features) {
    if (feature.geometry === null) {
      nullGeometryCount += 1;
      continue;
    }
    if (!AREA_GEOMETRY_TYPES.has(feature.geometry.type)) {
      droppedTypes.set(
        feature.geometry.type,
        (droppedTypes.get(feature.geometry.type) ?? 0) + 1,
      );
      continue;
    }
    const normalizedProperties = normalizeProperties(feature.properties);
    droppedPropertyCount += normalizedProperties.dropped;
    const geometry = feature.geometry as AreaGeometry;
    areas.push({
      type: "Feature",
      properties: normalizedProperties.properties,
      geometry: {
        type: geometry.type,
        coordinates: geometry.coordinates,
      } as AreaGeometry,
    } as AreaFeature);
  }

  if (nullGeometryCount > 0) {
    notes.push(
      `Dropped ${nullGeometryCount} ${plural(nullGeometryCount, "feature")} with no geometry.`,
    );
  }
  for (const [type, count] of droppedTypes) {
    notes.push(
      `Dropped ${count} ${type} ${plural(count, "feature")} because a boundary must contain area geometry.`,
    );
  }
  if (droppedPropertyCount > 0) {
    notes.push(
      `Dropped ${droppedPropertyCount} ${plural(droppedPropertyCount, "property", "properties")} to keep feature details within storage limits.`,
    );
  }

  return areas;
}

function validateCoordinateRanges(
  features: readonly AreaFeature[],
):
  | { ok: true; hadElevation: boolean; longitudeSpan: number }
  | NormalizeGeoJsonFailure {
  let hadElevation = false;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  let rangeError = false;
  let extraCoordinateError = false;

  for (const feature of features) {
    forEachPosition(feature.geometry.coordinates, (position) => {
      if (position.length >= 4) extraCoordinateError = true;
      if (position.length === 3) hadElevation = true;
      const [longitude, latitude] = position;
      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 ||
        Math.abs(latitude) > 90
      ) {
        rangeError = true;
      }
      minLongitude = Math.min(minLongitude, longitude);
      maxLongitude = Math.max(maxLongitude, longitude);
    });
  }

  if (extraCoordinateError) {
    return {
      ok: false,
      error:
        "A coordinate contains more than three values. Export two dimensional GeoJSON and try again.",
    };
  }
  if (rangeError) {
    return {
      ok: false,
      error:
        "Coordinates are outside the valid longitude and latitude range. The file may use projected coordinates or latitude before longitude. Re-export it in WGS 84 (EPSG:4326).",
    };
  }

  return {
    ok: true,
    hadElevation,
    longitudeSpan: maxLongitude - minLongitude,
  };
}

function normalizedCollection(
  features: AreaFeature[],
): GisBoundaryCollection {
  const initial: FeatureCollection<AreaGeometry, GisBoundaryProperties> = {
    type: "FeatureCollection",
    features,
  };
  truncate(initial, {
    coordinates: 2,
    precision: GEOJSON_COORD_DECIMALS,
    mutate: true,
  });
  const rewound = rewind(initial, {
    mutate: true,
  }) as FeatureCollection<AreaGeometry, GisBoundaryProperties>;
  const extent = bbox(rewound, { recompute: true }) as GisBoundaryBbox;

  return {
    type: "FeatureCollection",
    features: rewound.features as GisBoundaryFeature[],
    bbox: extent,
  };
}

function capError(
  featureCount: number,
  vertexCount: number,
): NormalizeGeoJsonFailure | null {
  if (featureCount > GEOJSON_MAX_FEATURES) {
    return {
      ok: false,
      error: `This boundary has ${featureCount} areas. The maximum is ${GEOJSON_MAX_FEATURES}. Combine areas or simplify the file and try again.`,
    };
  }
  if (vertexCount > GEOJSON_MAX_VERTICES) {
    return {
      ok: false,
      error: `This boundary has ${vertexCount} vertices. The maximum is ${GEOJSON_MAX_VERTICES}. Simplify it and upload again.`,
    };
  }
  return null;
}

/**
 * Normalize uploaded or pasted GeoJSON into the application boundary envelope.
 * The caller must run this on the server so capturedAt is server controlled.
 */
export function normalizeGeoJson({
  text,
  source,
  fileName,
}: NormalizeGeoJsonInput): NormalizeGeoJsonResult {
  const inputBytes = new TextEncoder().encode(text).byteLength;
  if (inputBytes > GEOJSON_MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: `This boundary is ${inputBytes} bytes. The maximum is ${GEOJSON_MAX_INPUT_BYTES} bytes. Simplify it and upload again.`,
    };
  }

  const issues = getIssues(text);
  if (issues.length > 0) return structuralError(issues[0]);

  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: "The GeoJSON root must be an object.",
    };
  }

  const notes: string[] = [];
  const crs = readDeclaredCrs(parsed);
  if (crs.present) {
    if (crs.name === null || !WGS84_CRS_PATTERN.test(crs.name)) {
      return {
        ok: false,
        error: crs.name
          ? `This file declares coordinate system ${crs.name}. Re-export it in WGS 84 (EPSG:4326).`
          : "This file declares a coordinate system that is not WGS 84. Re-export it in WGS 84 (EPSG:4326).",
      };
    }
    delete parsed.crs;
    notes.push("Removed the legacy WGS 84 coordinate system declaration.");
  }

  const coerced = coerceFeatureCollection(parsed);
  if ("ok" in coerced) return coerced;
  if (coerced.flattenedGeometryCount > 0) {
    notes.push(
      `Flattened ${coerced.flattenedGeometryCount} ${plural(coerced.flattenedGeometryCount, "geometry", "geometries")} from a GeometryCollection.`,
    );
  }

  const scavenged = scavenge(JSON.stringify(coerced.collection));
  for (const rejection of scavenged.rejected) {
    const reason = rejection.reasons
      .map((entry: { message: string }) => entry.message)
      .join(" ");
    notes.push(`Dropped a feature that was not valid. ${reason}`);
  }
  if (scavenged.result.type !== "FeatureCollection") {
    return {
      ok: false,
      error: "The GeoJSON could not be converted to a FeatureCollection.",
    };
  }

  const areaFeatures = normalizeAreaFeatures(
    scavenged.result.features,
    notes,
  );
  if (areaFeatures.length === 0) {
    return { ok: false, error: "The file contains no area geometry." };
  }

  const rangeResult = validateCoordinateRanges(areaFeatures);
  if (!rangeResult.ok) return rangeResult;
  if (rangeResult.longitudeSpan > MAX_LONGITUDE_SPAN_DEGREES) {
    return {
      ok: false,
      error:
        "This boundary appears to span half the globe. Check for swapped or malformed coordinates and try again.",
    };
  }
  if (rangeResult.hadElevation) {
    notes.push("Removed elevation values because the boundary map is two dimensional.");
  }

  const collection = normalizedCollection(areaFeatures);
  const featureCount = collection.features.length;
  const vertexCount = countVertices(collection.features);
  const overCap = capError(featureCount, vertexCount);
  if (overCap) return overCap;

  const boundary: GisBoundary = {
    version: 1,
    source,
    fileName: source === "upload" ? (fileName?.trim() || null) : null,
    capturedAt: new Date().toISOString(),
    collection,
    stats: {
      features: featureCount,
      vertices: vertexCount,
      areaHectares: area(collection) / SQUARE_METRES_PER_HECTARE,
      bbox: collection.bbox,
      center: [
        (collection.bbox[0] + collection.bbox[2]) / 2,
        (collection.bbox[1] + collection.bbox[3]) / 2,
      ],
    },
    notes,
  };

  if (source === "upload" && boundary.fileName === null) {
    return {
      ok: false,
      error: "Choose a GeoJSON file and try again.",
    };
  }
  if (serializedBytes(boundary) > GEOJSON_MAX_NORMALIZED_BYTES) {
    return {
      ok: false,
      error:
        "This boundary is too detailed to store. Simplify it and upload again.",
    };
  }

  return { ok: true, boundary: parseGisBoundary(boundary) };
}
