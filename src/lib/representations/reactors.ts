import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, lookupFacilityId, type LookupRepresentationInput } from "./lookup-fields";

export const reactorRepresentationSchema = z.object({
  ...lookupFields, version: lookupVersion, facilityId: lookupFacilityId,
});
export type ReactorRepresentation = z.infer<typeof reactorRepresentationSchema>;
export type ReactorRepresentationInput = Omit<LookupRepresentationInput<ReactorRepresentation>, "name"> & { identifier: string };
export function representReactor(row: ReactorRepresentationInput): ReactorRepresentation {
  return reactorRepresentationSchema.parse({ ...row, ...lookupInstants(row), name: row.identifier });
}
