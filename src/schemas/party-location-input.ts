import { z } from "zod";
import { LOCATION_DISTANCE_MIN_KM, LOCATION_DISTANCE_MAX_KM, PARTY_MAX_LOCATIONS, PARTY_NAME_MAX, LOCATION_PLACE_MAX, PARTY_ADDRESS_MAX } from "@/config/party-input";
import { SOIL_TEMPERATURE_MIN_C, SOIL_TEMPERATURE_MAX_C, expectedVersionSchema, gpsPairSuperRefine, requiredLatitudeSchema, requiredLongitudeSchema, uuidSchema } from "./helpers";
import { distanceSources } from "./distance-source";

export const partyName = z.string().trim().min(1).max(PARTY_NAME_MAX).describe(`Display name, trimmed, from 1 to ${PARTY_NAME_MAX} characters.`);
export const partyOptionalText = z.string().max(PARTY_NAME_MAX).nullable().optional().describe(`Optional plain text, at most ${PARTY_NAME_MAX} characters; null clears it.`);
export const partyAddress = z.string().max(PARTY_ADDRESS_MAX).nullable().optional().describe(`Site description, at most ${PARTY_ADDRESS_MAX} characters; null clears it.`);
export const partyVersionFields = { expectedVersion: expectedVersionSchema };
export const partyFacilityDistanceInput = z.strictObject({
  facilityId: uuidSchema().describe("Facility identifier in this Organization, UUID; archived facilities cannot be newly referenced."),
  distanceKm: z.number().min(LOCATION_DISTANCE_MIN_KM).max(LOCATION_DISTANCE_MAX_KM).nullable().describe(`One-way distance in km from ${LOCATION_DISTANCE_MIN_KM} to ${LOCATION_DISTANCE_MAX_KM}; null removes the pair. The server counts the round trip.`),
  distanceSource: z.enum(distanceSources).describe("Distance evidence: map_estimate is a mapped route, manual is operator-entered, document is documented evidence."),
});
const fields = {
  country: z.string().min(1).max(LOCATION_PLACE_MAX).describe("Country of the location, required on create."),
  stateRegion: z.string().max(LOCATION_PLACE_MAX).nullable().optional().describe("State or region; null clears it."),
  city: z.string().max(LOCATION_PLACE_MAX).nullable().optional().describe("City; null clears it."),
  gpsLatitude: requiredLatitudeSchema.describe("WGS 84 latitude in decimal degrees."),
  gpsLongitude: requiredLongitudeSchema.describe("WGS 84 longitude in decimal degrees."),
  isDefault: z.boolean().optional().describe("Whether to make this the default location; the last true value wins, otherwise the first location is default."),
  facilityDistances: z.array(partyFacilityDistanceInput).refine(
    rows => new Set(rows.map(row => row.facilityId)).size === rows.length,
    "Enter each facility only once.",
  ).optional().describe("One-way facility distance pairs; each facility appears at most once."),
};
const supplierFields = { ...fields, name: partyOptionalText.describe("Source location display name; null clears it.") };
export const supplierLocationApiInput = z.strictObject(supplierFields).superRefine(gpsPairSuperRefine);
export const supplierLocationInput = z.strictObject({ ...supplierFields, address: partyAddress }).superRefine(gpsPairSuperRefine);
export const customerLocationInput = z.strictObject({
  ...fields, name: partyName, siteDescription: partyAddress,
  defaultSoilTemperatureC: z.number().min(SOIL_TEMPERATURE_MIN_C).max(SOIL_TEMPERATURE_MAX_C).nullable().optional().describe(`Default soil temperature in degrees Celsius, from ${SOIL_TEMPERATURE_MIN_C} to ${SOIL_TEMPERATURE_MAX_C}; null clears it.`),
}).superRefine(gpsPairSuperRefine);
export const customerLocationApiInput = customerLocationInput;
export const partyLocations = <T extends z.ZodType>(schema: T) => z.array(schema)
  .min(1, "At least one location is required").max(PARTY_MAX_LOCATIONS).describe(`Initial locations in input order, from 1 to ${PARTY_MAX_LOCATIONS}.`);
