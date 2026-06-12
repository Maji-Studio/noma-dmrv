/**
 * Geo client entry point (ADR 0009). Server-only by contract — import from
 * `fn/` and server lib code only. Selects the active provider via
 * `GEO_PROVIDER`: "ors" (real OpenRouteService) or "stub" (deterministic
 * fixtures for hermetic CI; rejected in production at env parse time).
 */

import { env } from "@/config/env";
import { orsProvider } from "./ors";
import { stubProvider } from "./stub";
import type { GeoProvider } from "./types";

export type { GeocodeResult, GeoPoint, GeoProvider, RouteGeometry } from "./types";

const provider: GeoProvider = env.GEO_PROVIDER === "stub" ? stubProvider : orsProvider;

/**
 * Whether geocoding/routing calls can succeed in this environment. The UI
 * gates CALC + address search on this (decision 5 — degradation is gated
 * where the feature renders, never at env parse time).
 */
export function isRoutingConfigured(): boolean {
  return env.GEO_PROVIDER === "stub" || !!env.OPENROUTESERVICE_API_KEY;
}

export const geocode = provider.geocode.bind(provider);
export const reverseGeocode = provider.reverseGeocode.bind(provider);
export const routeDistanceKm = provider.routeDistanceKm.bind(provider);
export const routeGeometry = provider.routeGeometry.bind(provider);
