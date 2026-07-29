/**
 * Geo / map integration constants (ADR 0009 — provider-agnostic,
 * server-proxied geo). The provider stack is deliberately swappable:
 * MapLibre GL renderer, MapTiler basemap behind these constants,
 * OpenRouteService geocoding/routing behind the `src/lib/geo/` interface.
 */

// ---------------------------------------------------------------------------
// OpenRouteService (server-side only — key never reaches the browser)
// ---------------------------------------------------------------------------

// HeiGIT unified API hosts (api.openrouteservice.org is deprecated and shuts
// down 2026-08-24; the same key works on api.heigit.org). Routing and geocoding
// now live under separate path prefixes, so they need separate bases.
// Announcement: https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912

/** Base for ORS routing (directions). Path: `/v2/directions/<profile>`. */
export const ORS_ROUTING_BASE_URL = "https://api.heigit.org/openrouteservice";

/** Base for Pelias geocoding. Paths: `/search`, `/reverse`. */
export const ORS_GEOCODE_BASE_URL = "https://api.heigit.org/pelias/v1";

/** Road-vehicle routing profile (Transportation module: road method only). */
export const ORS_ROUTING_PROFILE = "driving-car";

/** Max geocode autocomplete results returned to the client. */
export const GEOCODE_MAX_RESULTS = 5;

/**
 * Outbound request timeout for ORS calls (ms). Deliberately short: this budget
 * is shared by the per-keystroke geocode autocomplete and the CALC button, so a
 * long wait would stall typing as well as clicks. A slow upstream therefore
 * aborts before its own error status arrives — the adapter reports that as a
 * distinct "did not respond in time" message rather than a network failure.
 */
export const ORS_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Per-coordinate snap radius (m) sent to the directions endpoint. ORS defaults
 * to 350 m and rejects the whole route (error 2010) when an endpoint — a
 * supplier yard, farm, or application plot — sits further than that from the
 * nearest mapped road, which silently degrades the map leg to a straight arc.
 * A bounded value snaps such points to the nearest road while still refusing
 * pathologically distant matches (unlimited `-1` could snap to the wrong road).
 */
export const ORS_SNAP_RADIUS_METERS = 5000;

// Per-user abuse limits for the geo server actions (sliding window,
// src/lib/rate-limit). Geocode fires per keystroke-debounce; routing is a
// deliberate button press.
export const GEO_GEOCODE_RATE_LIMIT = {
  key: "geo:geocode",
  max: 30,
  windowMs: 60_000,
} as const;

export const GEO_ROUTE_RATE_LIMIT = {
  key: "geo:route",
  max: 20,
  windowMs: 60_000,
} as const;

// Viewer-time route polylines (Carbon Viewer). One request covers a whole
// chain's legs; cache hits cost no ORS quota, so the window can stay tight.
export const GEO_ROUTE_GEOMETRY_RATE_LIMIT = {
  key: "geo:route-geometry",
  max: 30,
  windowMs: 60_000,
} as const;

/** Hard cap on legs per route-geometry request (bounds worst-case ORS fan-out). */
export const ROUTE_GEOMETRY_MAX_LEGS = 20;

/**
 * Decimals route-cache endpoints are rounded to before lookup/insert
 * (~1 m precision — float noise can't fragment the cache).
 */
export const ROUTE_CACHE_COORD_DECIMALS = 5;

// ---------------------------------------------------------------------------
// GIS boundary normalization (server-side only)
// ---------------------------------------------------------------------------

/** Maximum raw GeoJSON text accepted by the normalization action (1 MB). */
export const GEOJSON_MAX_INPUT_BYTES = 1024 * 1024;

/** Maximum normalized envelope persisted on an application (512 KB). */
export const GEOJSON_MAX_NORMALIZED_BYTES = 512 * 1024;

/** Maximum number of area features retained in one boundary. */
export const GEOJSON_MAX_FEATURES = 500;

/** Maximum number of positions retained across all area features. */
export const GEOJSON_MAX_VERTICES = 100_000;

/** Stored coordinate precision, approximately 0.1 m at the equator. */
export const GEOJSON_COORD_DECIMALS = 6;

/** Maximum number of property keys retained on one feature. */
export const GEOJSON_PROPERTY_KEY_CAP = 32;

/** Maximum serialized property bytes retained on one feature. */
export const GEOJSON_PROPERTY_BYTE_CAP = 8 * 1024;

/**
 * Smallest boundary area accepted, in hectares (1 m²). A collinear ring or a
 * self-intersecting bow-tie normalizes cleanly but encloses nothing, and the
 * evidence gate only checks that a boundary exists — so without a positive
 * area floor a boundary with no extent would satisfy the GIS requirement.
 */
export const GEOJSON_MIN_AREA_HECTARES = 0.0001;

/** Maximum normalization notes carried on one boundary envelope. */
export const GEOJSON_MAX_NOTES = 32;

/** Maximum characters in a single normalization note. */
export const GEOJSON_MAX_NOTE_LENGTH = 200;

/**
 * Per-user abuse limit for boundary normalization. Each call parses, rewinds,
 * and re-serializes up to a megabyte of text, so it is expensive in the way
 * `withAction`'s limiter exists for. A real operator commits one boundary per
 * application and retries a handful of times after a bad export.
 */
export const GIS_BOUNDARY_NORMALIZE_RATE_LIMIT = {
  key: "gis-boundary:normalize",
  max: 20,
  windowMs: 60_000,
} as const;

// ---------------------------------------------------------------------------
// MapTiler basemap (browser-safe, domain-locked public key)
// ---------------------------------------------------------------------------

/**
 * MapTiler style used as the base layer. The brand recoloring (white land on
 * orange-tinted paper, hairline plum boundaries, labels hidden) is applied on
 * top of this style at runtime by the map components.
 */
export function maptilerStyleUrl(key: string): string {
  return `https://api.maptiler.com/maps/dataviz/style.json?key=${encodeURIComponent(key)}`;
}

/** Esri World Imagery raster for the SAT toggle (no key required). */
export const SAT_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const SAT_TILE_ATTRIBUTION =
  "Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/** Desaturation applied to the SAT raster layer (concept build value). */
export const SAT_RASTER_SATURATION = -0.4;

// ---------------------------------------------------------------------------
// Map defaults
// ---------------------------------------------------------------------------

/**
 * Default map center when no position is set yet: Tanzania (the operating
 * region), roughly Dodoma. [lng, lat] — MapLibre order.
 */
export const DEFAULT_MAP_CENTER: [number, number] = [35.74, -6.17];

/** Default zoom when no position is set (country-level). */
export const DEFAULT_MAP_ZOOM = 5;

/** Zoom applied after a geocode hit or when focusing an existing position. */
export const FOCUSED_MAP_ZOOM = 13;

/** Debounce for the address-search input before hitting the geocoder (ms). */
export const GEOCODE_DEBOUNCE_MS = 400;
