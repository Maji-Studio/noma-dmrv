"use server";

/**
 * Geo server actions (ADR 0009). The OpenRouteService key stays server-side;
 * the browser only ever talks to these actions. Auth-guarded + rate-limited
 * via withAction. Returns ActionResult<T> like every other server function.
 */

import { GEO_GEOCODE_RATE_LIMIT, GEO_ROUTE_RATE_LIMIT } from "@/config/geo";
import { geocode, isRoutingConfigured, reverseGeocode, routeDistanceKm } from "@/lib/geo";
import type { GeoCapabilities, GeocodeResult } from "@/lib/geo/types";
import {
  geocodeQuerySchema,
  geoPointSchema,
  routeDistanceRequestSchema,
  type GeocodeQuery,
  type GeoPointInput,
  type RouteDistanceRequest,
} from "@/schemas/geo";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

/**
 * Capability probe so client components can gate CALC / address search
 * without shipping the secret-key presence logic to the browser.
 */
export async function getGeoCapabilitiesFn(): Promise<ActionResult<GeoCapabilities>> {
  return withAction(async () => ({ routingConfigured: isRoutingConfigured() }));
}

export async function geocodeAddressFn(
  input: GeocodeQuery
): Promise<ActionResult<GeocodeResult[]>> {
  return withAction(
    async () => {
      const { query } = geocodeQuerySchema.parse(input);
      return geocode(query);
    },
    { rateLimit: GEO_GEOCODE_RATE_LIMIT, zodErrorPrefix: "Invalid search" }
  );
}

export async function reverseGeocodeFn(
  input: GeoPointInput
): Promise<ActionResult<string | null>> {
  return withAction(
    async () => {
      const point = geoPointSchema.parse(input);
      return reverseGeocode(point);
    },
    { rateLimit: GEO_GEOCODE_RATE_LIMIT, zodErrorPrefix: "Invalid coordinates" }
  );
}

export async function routeDistanceFn(
  input: RouteDistanceRequest
): Promise<ActionResult<number>> {
  return withAction(
    async () => {
      const { origin, destination } = routeDistanceRequestSchema.parse(input);
      return routeDistanceKm(origin, destination);
    },
    { rateLimit: GEO_ROUTE_RATE_LIMIT, zodErrorPrefix: "Invalid route request" }
  );
}
