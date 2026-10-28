import { z } from "zod";
import { LOCATION_DISTANCE_MIN_KM, LOCATION_DISTANCE_MAX_KM } from "@/config/party-input";
import { distanceSources } from "./distance-source";
import { toClearableNumber, uuidSchema } from "./helpers";

export const facilityDistanceSchema = z.object({
  facilityId: uuidSchema().describe("Organization facility identifier, UUID."),
  distanceKm: z.number().positive().describe("Positive one-way road distance in kilometres."),
  distanceSource: z.enum(distanceSources).describe("Distance provenance: manual entry, GPS route estimate, or supporting document."),
});
export type FacilityDistance = z.infer<typeof facilityDistanceSchema> & { facilityName?: string };

// A null distance explicitly removes this facility's default. Omission preserves it.
export const facilityDistanceInputSchema = facilityDistanceSchema.extend({
  distanceKm: z.preprocess(toClearableNumber, z.number().positive("Distance must be greater than zero").min(LOCATION_DISTANCE_MIN_KM).max(LOCATION_DISTANCE_MAX_KM).nullable()),
});
export const facilityDistancesInputSchema = z.array(facilityDistanceInputSchema).refine(
  rows => new Set(rows.map(row => row.facilityId)).size === rows.length,
  "Enter each facility only once.",
).optional();
export type FacilityDistanceInput = z.infer<typeof facilityDistanceInputSchema>;
