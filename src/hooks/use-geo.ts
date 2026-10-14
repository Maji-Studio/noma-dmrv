"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { GeocodeResult } from "@/lib/geo/types";
import type { RouteGeometryByRequestId } from "@/data-access/geo-route-cache";
import {
  geocodeAddressFn,
  getGeoCapabilitiesFn,
  reverseGeocodeFn,
  routeDistanceFn,
  routeGeometriesFn,
} from "@/fn/geo";
import type {
  GeoPointInput,
  RouteDistanceRequest,
  RouteGeometriesRequest,
} from "@/schemas/geo";
import { unwrap } from "@/hooks/types";

const GEOCODE_MIN_QUERY_LENGTH = 3;
/** Geocode hits for the same query string never change mid-session. */
const GEOCODE_STALE_TIME_MS = 5 * 60 * 1000;

const geoKeys = {
  all: ["geo"] as const,
  capabilities: () => [...geoKeys.all, "capabilities"] as const,
  geocode: (query: string) => [...geoKeys.all, "geocode", query] as const,
  reverse: (point: GeoPointInput) =>
    [...geoKeys.all, "reverse", point.lat, point.lng] as const,
  // Keyed by id AND endpoint coords: a facility/supplier/customer GPS edit
  // moves a leg's endpoints without changing its id, and must not be served
  // road geometry cached for the old positions.
  routeGeometries: (legs: RouteGeometriesRequest["legs"]) =>
    [
      ...geoKeys.all,
      "route-geometries",
      ...legs
        .map(
          (leg) =>
            `${leg.id}:${leg.origin.lat},${leg.origin.lng}>${leg.destination.lat},${leg.destination.lng}`,
        )
        .sort(),
    ] as const,
};

/** Whether CALC / address search can succeed (server key present or stub). */
export function useGeoCapabilities() {
  return useQuery({
    queryKey: geoKeys.capabilities(),
    queryFn: async () => unwrap(await getGeoCapabilitiesFn()),
    // Env-derived; cannot change without a server restart.
    staleTime: Infinity,
  });
}

/** Debounce the query string before passing it here (GEOCODE_DEBOUNCE_MS). */
export function useGeocodeSearch(query: string, enabled = true) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: geoKeys.geocode(trimmed),
    queryFn: async (): Promise<GeocodeResult[]> =>
      unwrap(await geocodeAddressFn({ query: trimmed })),
    enabled: enabled && trimmed.length >= GEOCODE_MIN_QUERY_LENGTH,
    staleTime: GEOCODE_STALE_TIME_MS,
  });
}

/** Read-only confirmation label for a picked point (never written back). */
export function useReverseGeocode(point: GeoPointInput | null, enabled = true) {
  return useQuery({
    queryKey: point ? geoKeys.reverse(point) : [...geoKeys.all, "reverse", "none"],
    queryFn: async (): Promise<string | null> => {
      if (!point) return null;
      return unwrap(await reverseGeocodeFn(point));
    },
    enabled: enabled && point !== null,
    staleTime: GEOCODE_STALE_TIME_MS,
  });
}

/** CALC button: routed road distance (km) between two points. */
export function useRouteDistance() {
  return useMutation({
    mutationFn: async (request: RouteDistanceRequest): Promise<number> =>
      unwrap(await routeDistanceFn(request)),
  });
}

/** Roads don't move — geometry for a route set is stable for the session. */
const ROUTE_GEOMETRY_STALE_TIME_MS = 30 * 60 * 1000;

/**
 * Cached road polylines per caller-defined route id. Null geometry means the
 * caller should draw its straight dashed fallback. Pass null while endpoints
 * are unavailable or the map cannot render.
 */
export function useRouteGeometries(request: RouteGeometriesRequest | null) {
  return useQuery({
    queryKey: geoKeys.routeGeometries(request?.legs ?? []),
    queryFn: async (): Promise<RouteGeometryByRequestId> =>
      unwrap(await routeGeometriesFn(request!)),
    enabled: request !== null && request.legs.length > 0,
    staleTime: ROUTE_GEOMETRY_STALE_TIME_MS,
  });
}
