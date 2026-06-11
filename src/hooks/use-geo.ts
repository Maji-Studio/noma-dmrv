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

const GEOCODE_MIN_QUERY_LENGTH = 3;
/** Geocode hits for the same query string never change mid-session. */
const GEOCODE_STALE_TIME_MS = 5 * 60 * 1000;

export const geoKeys = {
  all: ["geo"] as const,
  capabilities: () => [...geoKeys.all, "capabilities"] as const,
  geocode: (query: string) => [...geoKeys.all, "geocode", query] as const,
  reverse: (point: GeoPointInput) =>
    [...geoKeys.all, "reverse", point.lat, point.lng] as const,
  routeGeometries: (legIds: string[]) =>
    [...geoKeys.all, "route-geometries", ...legIds] as const,
};

/** Whether CALC / address search can succeed (server key present or stub). */
export function useGeoCapabilities() {
  return useQuery({
    queryKey: geoKeys.capabilities(),
    queryFn: async () => {
      const result = await getGeoCapabilitiesFn();
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    // Env-derived; cannot change without a server restart.
    staleTime: Infinity,
  });
}

/** Debounce the query string before passing it here (GEOCODE_DEBOUNCE_MS). */
export function useGeocodeSearch(query: string, enabled = true) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: geoKeys.geocode(trimmed),
    queryFn: async (): Promise<GeocodeResult[]> => {
      const result = await geocodeAddressFn({ query: trimmed });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
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
      const result = await reverseGeocodeFn(point);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && point !== null,
    staleTime: GEOCODE_STALE_TIME_MS,
  });
}

/** CALC button: routed road distance (km) between two points. */
export function useRouteDistance() {
  return useMutation({
    mutationFn: async (request: RouteDistanceRequest): Promise<number> => {
      const result = await routeDistanceFn(request);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
  });
}

/** Roads don't move — geometry for a leg set is stable for the session. */
const ROUTE_GEOMETRY_STALE_TIME_MS = 30 * 60 * 1000;

/**
 * Carbon Viewer: road polylines per transport leg (null = straight dashed
 * fallback). Pass null while legs are still loading.
 */
export function useRouteGeometries(request: RouteGeometriesRequest | null) {
  const legIds = request?.legs.map((leg) => leg.id).sort() ?? [];
  return useQuery({
    queryKey: geoKeys.routeGeometries(legIds),
    queryFn: async (): Promise<RouteGeometryByRequestId> => {
      const result = await routeGeometriesFn(request!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: request !== null && request.legs.length > 0,
    staleTime: ROUTE_GEOMETRY_STALE_TIME_MS,
  });
}
