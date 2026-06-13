/**
 * OpenRouteService adapter (ADR 0009). Server-only — uses the secret
 * `OPENROUTESERVICE_API_KEY`, which must never reach the browser.
 *
 * PII rule: log the action + status + timing only — NEVER the address
 * string or coordinates (they identify suppliers/farmers). The logger's
 * redaction is a backstop, not a license.
 */

import { env } from "@/config/env";
import {
  GEOCODE_MAX_RESULTS,
  ORS_GEOCODE_BASE_URL,
  ORS_REQUEST_TIMEOUT_MS,
  ORS_ROUTING_BASE_URL,
  ORS_ROUTING_PROFILE,
  ORS_SNAP_RADIUS_METERS,
} from "@/config/geo";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import type { GeocodeResult, GeoPoint, GeoProvider, RouteGeometry } from "./types";

const log = logger.child({ mod: "geo" });

const METERS_PER_KM = 1000;
/** Routed distances are estimates — one decimal is plenty of precision. */
const DISTANCE_DECIMALS = 1;

function requireKey(): string {
  const key = env.OPENROUTESERVICE_API_KEY;
  if (!key) {
    throw new SafeError(
      "Geocoding/routing is not configured (OPENROUTESERVICE_API_KEY is missing)."
    );
  }
  return key;
}

async function orsFetch(
  action: string,
  url: string,
  init: RequestInit
): Promise<unknown> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(ORS_REQUEST_TIMEOUT_MS),
    });
  } catch {
    log.error(
      { action, code: "network", duration_ms: Date.now() - startedAt },
      "ors request failed (network)"
    );
    throw new SafeError("Could not reach the routing service. Try again.");
  }

  if (!response.ok) {
    log.error(
      {
        action,
        status: response.status,
        code: "http",
        duration_ms: Date.now() - startedAt,
      },
      "ors request failed (http)"
    );
    if (response.status === 401 || response.status === 403) {
      throw new SafeError("The routing service rejected the configured key.");
    }
    if (response.status === 429) {
      throw new SafeError("Routing service rate limit reached. Try again shortly.");
    }
    throw new SafeError("The routing service returned an error. Try again.");
  }

  log.debug(
    { action, status: response.status, duration_ms: Date.now() - startedAt },
    "ors request ok"
  );
  return response.json();
}

/** Minimal shape of an ORS/Pelias geocode response we rely on. */
interface PeliasResponse {
  features?: Array<{
    geometry?: { coordinates?: [number, number] };
    properties?: { label?: string };
  }>;
}

interface OrsDirectionsResponse {
  routes?: Array<{ summary?: { distance?: number } }>;
}

/** GeoJSON variant of the directions endpoint (route polyline). */
interface OrsDirectionsGeoJsonResponse {
  features?: Array<{
    geometry?: { coordinates?: [number, number][] };
    properties?: { summary?: { distance?: number } };
  }>;
}

export const orsProvider: GeoProvider = {
  async geocode(address: string): Promise<GeocodeResult[]> {
    const key = requireKey();
    const params = new URLSearchParams({
      text: address,
      size: String(GEOCODE_MAX_RESULTS),
    });
    const body = (await orsFetch(
      "geocode",
      `${ORS_GEOCODE_BASE_URL}/search?${params}`,
      { method: "GET", headers: { Authorization: key } }
    )) as PeliasResponse;

    return (body.features ?? [])
      .map((feature) => {
        const [lng, lat] = feature.geometry?.coordinates ?? [];
        const label = feature.properties?.label;
        if (typeof lat !== "number" || typeof lng !== "number" || !label) {
          return null;
        }
        return { label, lat, lng };
      })
      .filter((r): r is GeocodeResult => r !== null);
  },

  async reverseGeocode(point: GeoPoint): Promise<string | null> {
    const key = requireKey();
    const params = new URLSearchParams({
      "point.lat": String(point.lat),
      "point.lon": String(point.lng),
      size: "1",
    });
    const body = (await orsFetch(
      "reverse-geocode",
      `${ORS_GEOCODE_BASE_URL}/reverse?${params}`,
      { method: "GET", headers: { Authorization: key } }
    )) as PeliasResponse;

    return body.features?.[0]?.properties?.label ?? null;
  },

  async routeDistanceKm(origin: GeoPoint, destination: GeoPoint): Promise<number> {
    const key = requireKey();
    const body = (await orsFetch(
      "route",
      `${ORS_ROUTING_BASE_URL}/v2/directions/${ORS_ROUTING_PROFILE}`,
      {
        method: "POST",
        headers: {
          Authorization: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [origin.lng, origin.lat],
            [destination.lng, destination.lat],
          ],
          radiuses: [ORS_SNAP_RADIUS_METERS, ORS_SNAP_RADIUS_METERS],
        }),
      }
    )) as OrsDirectionsResponse;

    const meters = body.routes?.[0]?.summary?.distance;
    if (typeof meters !== "number" || !Number.isFinite(meters)) {
      throw new SafeError(
        "No road route found between these points. Enter the distance manually."
      );
    }
    const km = meters / METERS_PER_KM;
    return Number(km.toFixed(DISTANCE_DECIMALS));
  },

  async routeGeometry(origin: GeoPoint, destination: GeoPoint): Promise<RouteGeometry> {
    const key = requireKey();
    const body = (await orsFetch(
      "route-geometry",
      `${ORS_ROUTING_BASE_URL}/v2/directions/${ORS_ROUTING_PROFILE}/geojson`,
      {
        method: "POST",
        headers: {
          Authorization: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [origin.lng, origin.lat],
            [destination.lng, destination.lat],
          ],
          radiuses: [ORS_SNAP_RADIUS_METERS, ORS_SNAP_RADIUS_METERS],
        }),
      }
    )) as OrsDirectionsGeoJsonResponse;

    const feature = body.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    const meters = feature?.properties?.summary?.distance;
    // Per-tuple check: a malformed polyline would be persisted into
    // geo_route_cache and break map rendering on every later view.
    const hasValidCoordinates =
      Array.isArray(coordinates) &&
      coordinates.length >= 2 &&
      coordinates.every(
        (pair) =>
          Array.isArray(pair) &&
          pair.length >= 2 &&
          Number.isFinite(pair[0]) &&
          Number.isFinite(pair[1])
      );
    if (!hasValidCoordinates || typeof meters !== "number" || !Number.isFinite(meters)) {
      throw new SafeError("No road route found between these points.");
    }
    return {
      coordinates,
      distanceKm: Number((meters / METERS_PER_KM).toFixed(DISTANCE_DECIMALS)),
    };
  },
};
