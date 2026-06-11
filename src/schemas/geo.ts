import { z } from "zod";

/**
 * Action schemas for the geo server actions (`src/fn/geo.ts`). These are
 * programmatic payloads (numbers from the map / form state), not raw form
 * strings, so plain bounded z.number() is correct here.
 */

export const geoPointSchema = z.object({
  lat: z
    .number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90"),
  lng: z
    .number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180"),
});

export type GeoPointInput = z.infer<typeof geoPointSchema>;

export const geocodeQuerySchema = z.object({
  query: z.string().trim().min(3, "Type at least 3 characters").max(200),
});

export type GeocodeQuery = z.infer<typeof geocodeQuerySchema>;

export const routeDistanceRequestSchema = z.object({
  origin: geoPointSchema,
  destination: geoPointSchema,
});

export type RouteDistanceRequest = z.infer<typeof routeDistanceRequestSchema>;
