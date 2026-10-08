import { z } from "zod";
import { DRIVER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "../etag";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const driverRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
});
export type DriverRepresentation = z.infer<typeof driverRepresentationSchema>;
export type DriverRepresentationInput = LookupRepresentationInput<DriverRepresentation>;

export function representDriver(row: DriverRepresentationInput): DriverRepresentation {
  return driverRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}

export function driverEtag(row: Pick<DriverRepresentation, "version">): string {
  return representationEtag(row.version, DRIVER_REPRESENTATION_REVISION);
}
