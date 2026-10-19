import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const supplierRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  sourceRegion: z.string().nullable().describe("Source region, or null when unspecified."),
  archivedAt: z.iso.datetime().nullable().describe("Archive event instant in UTC (RFC 3339), or null when active."),
});
export type SupplierRepresentation = z.infer<typeof supplierRepresentationSchema>;
export type SupplierRepresentationInput = LookupRepresentationInput<SupplierRepresentation> & { archivedAt: Date | string | null };

export function representSupplier(row: SupplierRepresentationInput): SupplierRepresentation {
  return supplierRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}
