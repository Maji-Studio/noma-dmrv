import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";

export type GisBoundaryBbox = [number, number, number, number];
export type GisBoundaryCenter = [number, number];
export type GisBoundaryProperties = Record<string, unknown>;
export type GisBoundaryFeature =
  | Feature<Polygon, GisBoundaryProperties>
  | Feature<MultiPolygon, GisBoundaryProperties>;

export type GisBoundaryCollection = Omit<
  FeatureCollection<Polygon | MultiPolygon, GisBoundaryProperties>,
  "bbox" | "features"
> & {
  features: GisBoundaryFeature[];
  bbox: GisBoundaryBbox;
};

export interface GisBoundary {
  version: 1;
  source: "upload" | "paste";
  fileName: string | null;
  capturedAt: string;
  collection: GisBoundaryCollection;
  stats: {
    features: number;
    vertices: number;
    areaHectares: number;
    bbox: GisBoundaryBbox;
    center: GisBoundaryCenter;
  };
  notes: string[];
}

export interface GeoJsonIssueLocation {
  from: number;
  to: number;
}

export type NormalizeGeoJsonResult =
  | { ok: true; boundary: GisBoundary }
  | {
      ok: false;
      error: string;
      location?: GeoJsonIssueLocation;
    };
