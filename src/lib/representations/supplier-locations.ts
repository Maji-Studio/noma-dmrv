import { facilityDistanceSchema } from "@/schemas/facility-distances";
import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const supplierLocationRepresentationSchema = z.object({
  ...lookupFields,
  name: z.string().nullable().describe("Source location display name, plain text, or null when unspecified."),
  country: z.string().describe("Country of the location."),
  stateRegion: z.string().nullable().describe("State or region, or null when unspecified."),
  city: z.string().nullable().describe("City, or null when unspecified."),
  version: lookupVersion,
  isDefault: z.boolean().describe("Whether this is the supplier default source."),
  archivedAt: z.null().describe("Always null; a location follows its supplier archive state."),
  supplierId: z.uuid().describe("Owning supplier identifier, UUID."),
  facilityDistances: z.array(facilityDistanceSchema).describe("One-way road distances by facility, in kilometres. Missing pairs have no recorded default. GPS-derived values are estimates. The server counts the round trip."),
  gpsLatitude: z.number().describe("WGS 84 latitude in decimal degrees."),
  gpsLongitude: z.number().describe("WGS 84 longitude in decimal degrees."),
}).omit({ code: true });
export type SupplierLocationRepresentation = z.infer<typeof supplierLocationRepresentationSchema>;
export type SupplierLocationRepresentationInput = LookupRepresentationInput<SupplierLocationRepresentation>;

export function representSupplierLocation(row: SupplierLocationRepresentationInput): SupplierLocationRepresentation {
  return supplierLocationRepresentationSchema.parse({ ...row, ...lookupInstants(row), archivedAt: null });
}
