import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const facilityRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  timeZone: z.string().describe("IANA facility time zone used to interpret local business dates and times."),
});
export type FacilityRepresentation = z.infer<typeof facilityRepresentationSchema>;
export type FacilityRepresentationInput = Omit<LookupRepresentationInput<FacilityRepresentation>, "timeZone"> & { timezone: string };

export function representFacility(row: FacilityRepresentationInput): FacilityRepresentation {
  return facilityRepresentationSchema.parse({ ...row, ...lookupInstants(row), timeZone: row.timezone });
}
