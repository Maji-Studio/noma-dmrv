/**
 * Provider-agnostic geo interface (ADR 0009). Server-only by contract —
 * import only from `fn/`, `data-access/`, and lib server code; never from a
 * client component. The active adapter is selected in `./index.ts` via
 * `GEO_PROVIDER` (ors | stub).
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  /** Human-readable place label (e.g. "Dodoma, Tanzania"). */
  label: string;
  lat: number;
  lng: number;
}

export interface GeoCapabilities {
  /** True when geocoding + CALC routing can succeed (key present or stub). */
  routingConfigured: boolean;
}

export interface GeoProvider {
  /** Forward-geocode a free-text address into candidate positions. */
  geocode(address: string): Promise<GeocodeResult[]>;
  /**
   * Reverse-geocode a point into a display label (read-only confirmation —
   * never written back into an entity's `address` field). Null when the
   * provider has no answer.
   */
  reverseGeocode(point: GeoPoint): Promise<string | null>;
  /** Road distance in km between two points (routed estimate, not measured). */
  routeDistanceKm(origin: GeoPoint, destination: GeoPoint): Promise<number>;
}
