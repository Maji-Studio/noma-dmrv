import { z } from "zod";
import { lookupFields, lookupInstants, type LookupRepresentationInput } from "./lookup-fields";

export const driverRepresentationSchema = z.object({
  ...lookupFields,
});
export type DriverRepresentation = z.infer<typeof driverRepresentationSchema>;
export type DriverRepresentationInput = LookupRepresentationInput<DriverRepresentation>;

export function representDriver(row: DriverRepresentationInput): DriverRepresentation {
  return driverRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
