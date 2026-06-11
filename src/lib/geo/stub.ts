/**
 * Deterministic stub adapter for hermetic PR CI (GEO_PROVIDER=stub in
 * .env.test). No network, no key, fixed fixtures — e2e specs can assert
 * exact geocode hits and CALC distances. Rejected in production by the env
 * superRefine.
 */

import type { GeocodeResult, GeoPoint, GeoProvider } from "./types";

const EARTH_RADIUS_KM = 6371;
/** Crude road-vs-crow-flies factor so stub distances look plausible. */
const STUB_ROAD_FACTOR = 1.2;
const DISTANCE_DECIMALS = 1;

/**
 * Fixed geocode fixtures (Tanzanian operating region). Matched
 * case-insensitively by substring; unknown queries return a single
 * deterministic fallback so any address "resolves" in tests.
 */
export const STUB_GEOCODE_FIXTURES: GeocodeResult[] = [
  { label: "Dodoma, Tanzania", lat: -6.163, lng: 35.7516 },
  { label: "Dar es Salaam, Tanzania", lat: -6.7924, lng: 39.2083 },
  { label: "Morogoro, Tanzania", lat: -6.8278, lng: 37.6591 },
  { label: "Arusha, Tanzania", lat: -3.3869, lng: 36.683 },
];

export const STUB_FALLBACK_RESULT: GeocodeResult = {
  label: "Stub Location, Tanzania",
  lat: -6.5,
  lng: 36.0,
};

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine great-circle distance (km). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Deterministic stub road distance — also exported for e2e assertions. */
export function stubRouteDistanceKm(origin: GeoPoint, destination: GeoPoint): number {
  return Number((haversineKm(origin, destination) * STUB_ROAD_FACTOR).toFixed(DISTANCE_DECIMALS));
}

export const stubProvider: GeoProvider = {
  async geocode(address: string): Promise<GeocodeResult[]> {
    const query = address.trim().toLowerCase();
    if (!query) return [];
    const matches = STUB_GEOCODE_FIXTURES.filter((fixture) =>
      fixture.label.toLowerCase().includes(query)
    );
    return matches.length > 0 ? matches : [STUB_FALLBACK_RESULT];
  },

  async reverseGeocode(point: GeoPoint): Promise<string | null> {
    const nearest = STUB_GEOCODE_FIXTURES.find(
      (fixture) => haversineKm(fixture, point) < 50
    );
    return nearest?.label ?? STUB_FALLBACK_RESULT.label;
  },

  async routeDistanceKm(origin: GeoPoint, destination: GeoPoint): Promise<number> {
    return stubRouteDistanceKm(origin, destination);
  },
};
