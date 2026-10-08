import { z } from "zod";
import { STORAGE_LOCATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "../etag";
import { lookupFields, lookupInstants, lookupVersion, lookupFacilityId, type LookupRepresentationInput } from "./lookup-fields";

export const storageLocationRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  facilityId: lookupFacilityId,
  type: z.enum(["feedstock_bin", "biochar_bin", "product_bin"]).describe("Material lane: feedstock, biochar, or product bin."),
  capacityKg: z.number().nullable().describe("Storage capacity in kilograms, or null when unspecified."),
  feedstockTypeId: z.uuid().nullable().describe("Allowed feedstock type identifier, UUID, or null when unrestricted or inapplicable."),
});
export type StorageLocationRepresentation = z.infer<typeof storageLocationRepresentationSchema>;
export type StorageLocationRepresentationInput = LookupRepresentationInput<StorageLocationRepresentation>;

export function representStorageLocation(row: StorageLocationRepresentationInput): StorageLocationRepresentation {
  return storageLocationRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}

export function storageLocationEtag(row: Pick<StorageLocationRepresentation, "version">): string {
  return representationEtag(row.version, STORAGE_LOCATION_REPRESENTATION_REVISION);
}
