/**
 * Read-through route-geometry cache (map-integration Phase 2).
 *
 * The Carbon Viewer asks for road polylines per transport leg at view time;
 * this resolves each request from `geo_route_cache` first and only calls the
 * geo provider on a miss (ORS quota is tight; ORS permits caching — ADR 0009).
 * A leg whose route cannot be resolved (routing unconfigured, no road found,
 * provider error) yields `null` — the viewer draws its straight dashed
 * fallback. PII rule: log counts + actions only, never coordinates.
 */
import { and, eq, or, type SQL } from "drizzle-orm";
import { ORS_ROUTING_PROFILE, ROUTE_CACHE_COORD_DECIMALS } from "@/config/geo";
import { db } from "@/db";
import { geoRouteCache } from "@/db/schema";
import { isRoutingConfigured, routeGeometry, type GeoPoint, type RouteGeometry } from "@/lib/geo";
import { logger } from "@/lib/log";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

const log = logger.child({ mod: "geo-route-cache" });

export interface RouteGeometryRequest {
  /** Caller-side correlation id (the transport-leg id). */
  id: string;
  origin: GeoPoint;
  destination: GeoPoint;
}

/** Route polyline per request id; null = draw the straight dashed fallback. */
export type RouteGeometryByRequestId = Record<string, RouteGeometry | null>;

function roundCoord(value: number): number {
  return Number(value.toFixed(ROUTE_CACHE_COORD_DECIMALS));
}

interface CacheKey {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
}

function cacheKey(request: RouteGeometryRequest): CacheKey {
  return {
    originLat: roundCoord(request.origin.lat),
    originLng: roundCoord(request.origin.lng),
    destinationLat: roundCoord(request.destination.lat),
    destinationLng: roundCoord(request.destination.lng),
  };
}

function keyString(key: CacheKey): string {
  return `${key.originLat},${key.originLng}:${key.destinationLat},${key.destinationLng}`;
}

export async function getRouteGeometries(
  ctx: OrgContext,
  requests: RouteGeometryRequest[]
): Promise<RouteGeometryByRequestId> {
  // Authenticated + org-scoped caller required, but the cache itself stays
  // GLOBAL (no organizationId column): it stores public road geometry keyed by
  // rounded coordinates, never tenant data (ADR 0010 exclusion).
  requireOrgScope(ctx);

  const result: RouteGeometryByRequestId = {};
  if (requests.length === 0) {
    return result;
  }
  if (!isRoutingConfigured()) {
    for (const request of requests) {
      result[request.id] = null;
    }
    return result;
  }

  // Distinct endpoint pairs — several legs can share a route (e.g. multiple
  // feedstocks from one supplier), and each pair costs at most one ORS call.
  const keyByRequestId = new Map<string, CacheKey>();
  const uniqueKeys = new Map<string, CacheKey>();
  for (const request of requests) {
    const key = cacheKey(request);
    keyByRequestId.set(request.id, key);
    uniqueKeys.set(keyString(key), key);
  }

  const cached = await readCache([...uniqueKeys.values()]);
  let misses = 0;
  let failures = 0;

  for (const [keyStr, key] of uniqueKeys) {
    if (cached.has(keyStr)) continue;
    misses++;
    try {
      const geometry = await routeGeometry(
        { lat: key.originLat, lng: key.originLng },
        { lat: key.destinationLat, lng: key.destinationLng }
      );
      cached.set(keyStr, geometry);
      await db
        .insert(geoRouteCache)
        .values({
          profile: ORS_ROUTING_PROFILE,
          ...key,
          coordinates: geometry.coordinates,
          distanceKm: geometry.distanceKm,
        })
        .onConflictDoNothing();
    } catch (error) {
      // Unroutable pair (no road, provider error) — the viewer falls back to
      // a straight dashed line for these legs. Not cached: a transient ORS
      // failure should not pin the fallback forever.
      failures++;
      log.debug(
        { err: error instanceof Error ? error.message : String(error) },
        "route geometry fetch failed"
      );
    }
  }

  log.info(
    { action: "route-geometries", legs: requests.length, pairs: uniqueKeys.size, misses, failures },
    "route geometries resolved"
  );

  for (const request of requests) {
    const key = keyByRequestId.get(request.id)!;
    result[request.id] = cached.get(keyString(key)) ?? null;
  }
  return result;
}

async function readCache(keys: CacheKey[]): Promise<Map<string, RouteGeometry>> {
  const conditions: SQL[] = keys.map(
    (key) =>
      and(
        eq(geoRouteCache.profile, ORS_ROUTING_PROFILE),
        eq(geoRouteCache.originLat, key.originLat),
        eq(geoRouteCache.originLng, key.originLng),
        eq(geoRouteCache.destinationLat, key.destinationLat),
        eq(geoRouteCache.destinationLng, key.destinationLng)
      )!
  );

  const rows = await db
    .select({
      originLat: geoRouteCache.originLat,
      originLng: geoRouteCache.originLng,
      destinationLat: geoRouteCache.destinationLat,
      destinationLng: geoRouteCache.destinationLng,
      coordinates: geoRouteCache.coordinates,
      distanceKm: geoRouteCache.distanceKm,
    })
    .from(geoRouteCache)
    .where(or(...conditions));

  return new Map(
    rows.map((row) => [
      keyString(row),
      { coordinates: row.coordinates, distanceKm: row.distanceKm },
    ])
  );
}
