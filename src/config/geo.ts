/**
 * Geo / map integration constants (ADR 0009 — provider-agnostic,
 * server-proxied geo). The provider stack is deliberately swappable:
 * MapLibre GL renderer, MapTiler basemap behind these constants,
 * OpenRouteService geocoding/routing behind the `src/lib/geo/` interface.
 */

// ---------------------------------------------------------------------------
// OpenRouteService (server-side only — key never reaches the browser)
// ---------------------------------------------------------------------------

export const ORS_BASE_URL = "https://api.openrouteservice.org";

/** Road-vehicle routing profile (Transportation module: road method only). */
export const ORS_ROUTING_PROFILE = "driving-car";

/** Max geocode autocomplete results returned to the client. */
export const GEOCODE_MAX_RESULTS = 5;

/** Outbound request timeout for ORS calls (ms). */
export const ORS_REQUEST_TIMEOUT_MS = 10_000;

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
