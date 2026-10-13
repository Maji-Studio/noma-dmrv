import { z } from "zod";
import { durabilityOptions } from "@/schemas/credit-batches";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const facilityRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  timeZone: z.string().describe("IANA facility time zone used to interpret local business dates and times."),
  durabilityOption: z.enum(durabilityOptions).describe("Durability tier the facility claims, which its credit batches and lab samples inherit: 200_year (H/C_org) or 1000_year (R0 and TGA evidence)."),
});
export type FacilityRepresentation = z.infer<typeof facilityRepresentationSchema>;
export type FacilityRepresentationInput = Omit<LookupRepresentationInput<FacilityRepresentation>, "timeZone"> & { timezone: string };

export function representFacility(row: FacilityRepresentationInput): FacilityRepresentation {
  return facilityRepresentationSchema.parse({ ...row, ...lookupInstants(row), timeZone: row.timezone });
}
