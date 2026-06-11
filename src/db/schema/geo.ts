import {
  doublePrecision,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ============================================
// Geo route cache - viewer-time road polylines (map-integration Phase 2)
// ============================================
//
// Caches OpenRouteService route geometry keyed by rounded endpoints + routing
// profile so the Carbon Viewer never re-fetches a road it has already drawn
// (ORS free tier is tightly rate-limited; ORS permits caching, unlike the
// Mapbox escape hatch — ADR 0009). The polyline is ILLUSTRATIVE: the carbon
// number always stays the transport leg's stored distanceKm, and geometry is
// never written onto a leg.

export const geoRouteCache = pgTable(
  "geo_route_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Routing profile the geometry was computed with (e.g. driving-car). */
    profile: text("profile").notNull(),
    // Endpoints rounded to ROUTE_CACHE_COORD_DECIMALS (@/config/geo) before
    // lookup/insert so float noise can't fragment the cache.
    originLat: doublePrecision("origin_lat").notNull(),
    originLng: doublePrecision("origin_lng").notNull(),
    destinationLat: doublePrecision("destination_lat").notNull(),
    destinationLng: doublePrecision("destination_lng").notNull(),
    /** Route polyline as [lng, lat] pairs (GeoJSON order). */
    coordinates: jsonb("coordinates").$type<[number, number][]>().notNull(),
    /** Routed distance of the polyline, km (display only — never credit math). */
    distanceKm: real("distance_km").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("geo_route_cache_key_idx").on(
      table.profile,
      table.originLat,
      table.originLng,
      table.destinationLat,
      table.destinationLng
    ),
  ]
);

export type GeoRouteCacheEntry = typeof geoRouteCache.$inferSelect;
export type NewGeoRouteCacheEntry = typeof geoRouteCache.$inferInsert;
