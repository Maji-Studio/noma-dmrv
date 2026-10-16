import { z } from "zod";
import { LOCATION_DISTANCE_MIN_KM, LOCATION_DISTANCE_MAX_KM, PARTY_MAX_LOCATIONS } from "@/config/party-input";
import { SOIL_TEMPERATURE_MIN_C, SOIL_TEMPERATURE_MAX_C, expectedVersionSchema, gpsPairSuperRefine, requiredLatitudeSchema, requiredLongitudeSchema, uuidSchema } from "./helpers";
import { distanceSources } from "./distance-source";

const NAME_MAX = 255;
const PLACE_MAX = 100;
const ADDRESS_MAX = 500;
export const partyName = z.string().trim().min(1).max(NAME_MAX);
export const partyOptionalText = z.string().max(NAME_MAX).nullable().optional();
export const partyAddress = z.string().max(ADDRESS_MAX).nullable().optional();
export const partyVersionFields = { expectedVersion: expectedVersionSchema };
export const partyFacilityDistanceInput = z.strictObject({
  facilityId: uuidSchema(),
  distanceKm: z.number().min(LOCATION_DISTANCE_MIN_KM).max(LOCATION_DISTANCE_MAX_KM).nullable(),
  distanceSource: z.enum(distanceSources),
});
const fields = {
  country: z.string().min(1).max(PLACE_MAX),
  stateRegion: z.string().max(PLACE_MAX).nullable().optional(),
  city: z.string().max(PLACE_MAX).nullable().optional(),
  gpsLatitude: requiredLatitudeSchema,
  gpsLongitude: requiredLongitudeSchema,
  isDefault: z.boolean().optional(),
  facilityDistances: z.array(partyFacilityDistanceInput).refine(
    rows => new Set(rows.map(row => row.facilityId)).size === rows.length,
    "Enter each facility only once.",
  ).optional(),
};
const supplierFields = { ...fields, name: partyOptionalText };
export const supplierLocationApiInput = z.strictObject(supplierFields).superRefine(gpsPairSuperRefine);
export const supplierLocationInput = z.strictObject({ ...supplierFields, address: partyAddress }).superRefine(gpsPairSuperRefine);
export const customerLocationInput = z.strictObject({
  ...fields, name: partyName, siteDescription: partyAddress,
  defaultSoilTemperatureC: z.number().min(SOIL_TEMPERATURE_MIN_C).max(SOIL_TEMPERATURE_MAX_C).nullable().optional(),
}).superRefine(gpsPairSuperRefine);
export const customerLocationApiInput = customerLocationInput;
export const partyLocations = <T extends z.ZodType>(schema: T) => z.array(schema)
  .min(1, "At least one location is required").max(PARTY_MAX_LOCATIONS);
