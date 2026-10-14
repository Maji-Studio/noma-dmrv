import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const customerRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
}).omit({ archivedAt: true });
export type CustomerRepresentation = z.infer<typeof customerRepresentationSchema>;
export type CustomerRepresentationInput = LookupRepresentationInput<CustomerRepresentation>;

/** Customer contact fields are private and never published. */
export function representCustomer(row: CustomerRepresentationInput): CustomerRepresentation {
  return customerRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
