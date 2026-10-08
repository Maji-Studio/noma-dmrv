import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const supplierLocationRepresentationSchema = z.object({
  ...lookupFields,
  name: z.string().nullable().describe("Source location display name, plain text, or null when unspecified."),
  version: lookupVersion,
  supplierId: z.uuid().describe("Owning supplier identifier, UUID."),
  gpsLatitude: z.number().nullable().describe("WGS 84 latitude in decimal degrees, or null when unspecified."),
  gpsLongitude: z.number().nullable().describe("WGS 84 longitude in decimal degrees, or null when unspecified."),
}).omit({ code: true });
export type SupplierLocationRepresentation = z.infer<typeof supplierLocationRepresentationSchema>;
export type SupplierLocationRepresentationInput = LookupRepresentationInput<SupplierLocationRepresentation>;

export function representSupplierLocation(row: SupplierLocationRepresentationInput): SupplierLocationRepresentation {
  return supplierLocationRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
