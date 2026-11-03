import { OUTPUT_DRAW_ORDERS, OUTPUT_STOCK_MODES } from "@/lib/output-stock/stock-mode";
import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, lookupFacilityId, type LookupRepresentationInput } from "./lookup-fields";

export const storageLocationRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  facilityId: lookupFacilityId,
  type: z.enum(["feedstock_bin", "biochar_bin", "product_bin"]).describe("Material lane: feedstock, biochar, or product bin."),
  stockMode: z.enum(OUTPUT_STOCK_MODES).describe("Split draws deliveries in order in feedstock bins and keeps sub-bins apart in output bins. Mix draws remaining stock in proportion."),
  drawOrder: z.enum(OUTPUT_DRAW_ORDERS).describe("Draw order for split bins, including feedstock deliveries. Ignored by mix bins."),
  capacityKg: z.number().nullable().describe("Storage capacity in kilograms, or null when unspecified."),
  formulationId: z.uuid().nullable().describe("Formulation claimed by a product bin, UUID; null for other bin types or an unclaimed product bin."),
  feedstockTypeId: z.uuid().nullable().describe("Allowed feedstock type identifier, UUID, or null when unrestricted or inapplicable."),
});
export type StorageLocationRepresentation = z.infer<typeof storageLocationRepresentationSchema>;
export type StorageLocationRepresentationInput = LookupRepresentationInput<StorageLocationRepresentation>;

export function representStorageLocation(row: StorageLocationRepresentationInput): StorageLocationRepresentation {
  return storageLocationRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
