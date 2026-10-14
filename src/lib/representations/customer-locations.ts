import { z } from "zod";
import { distanceSources } from "@/schemas/distance-source";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const customerLocationRepresentationSchema = z.object({
  ...lookupFields,
  name: z.string().nullable().describe("Customer location display name, plain text, or null when unspecified."),
  customerId: z.uuid().describe("Owning customer identifier, UUID."),
  gpsLatitude: z.number().nullable().describe("WGS 84 latitude in decimal degrees, or null when unspecified."),
  gpsLongitude: z.number().nullable().describe("WGS 84 longitude in decimal degrees, or null when unspecified."),
  distanceFromFacilityKm: z.number().nullable().describe("One-way road distance from the facility in kilometres, or null when unspecified. The server counts the round trip."),
  distanceSource: z.literal([...distanceSources, null]).describe("Provenance of the one-way distance, or null when unspecified. The server counts the round trip."),
  isDefault: z.boolean().describe("Whether this is the customer's default destination."),
  version: lookupVersion,
}).omit({ code: true, archivedAt: true });
export type CustomerLocationRepresentation = z.infer<typeof customerLocationRepresentationSchema>;
export type CustomerLocationRepresentationInput = LookupRepresentationInput<CustomerLocationRepresentation>;

export function representCustomerLocation(row: CustomerLocationRepresentationInput): CustomerLocationRepresentation {
  return customerLocationRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
