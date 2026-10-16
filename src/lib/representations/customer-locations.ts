import { facilityDistanceSchema } from "@/schemas/facility-distances";
import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const customerLocationRepresentationSchema = z.object({
  ...lookupFields,
  name: z.string().describe("Customer location display name, plain text."),
  customerId: z.uuid().describe("Owning customer identifier, UUID."),
  facilityDistances: z.array(facilityDistanceSchema).describe("One-way road distances by facility, in kilometres. Missing pairs have no recorded default. GPS-derived values are estimates. The server counts the round trip."),
  gpsLatitude: z.number().describe("WGS 84 latitude in decimal degrees."),
  gpsLongitude: z.number().describe("WGS 84 longitude in decimal degrees."),
  isDefault: z.boolean().describe("Whether this is the customer's default destination."),
  version: lookupVersion,
}).omit({ code: true, archivedAt: true });
export type CustomerLocationRepresentation = z.infer<typeof customerLocationRepresentationSchema>;
export type CustomerLocationRepresentationInput = LookupRepresentationInput<CustomerLocationRepresentation>;

export function representCustomerLocation(row: CustomerLocationRepresentationInput): CustomerLocationRepresentation {
  return customerLocationRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
