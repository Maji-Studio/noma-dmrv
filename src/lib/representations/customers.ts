import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const customerRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  cropType: z.string().nullable().describe("Crop type, or null when unspecified."),
  archivedAt: z.iso.datetime().nullable().describe("Archive event instant in UTC (RFC 3339), or null when active."),
});
export type CustomerRepresentation = z.infer<typeof customerRepresentationSchema>;
export type CustomerRepresentationInput = LookupRepresentationInput<CustomerRepresentation> & { archivedAt: Date | string | null };

/** Customer contact fields are private and never published. */
export function representCustomer(row: CustomerRepresentationInput): CustomerRepresentation {
  return customerRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
