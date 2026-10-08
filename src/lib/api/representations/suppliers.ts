import { z } from "zod";
import { SUPPLIER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "../etag";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const supplierRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
});
export type SupplierRepresentation = z.infer<typeof supplierRepresentationSchema>;
export type SupplierRepresentationInput = LookupRepresentationInput<SupplierRepresentation>;

export function representSupplier(row: SupplierRepresentationInput): SupplierRepresentation {
  return supplierRepresentationSchema.parse({ ...row, ...lookupInstants(row) });
}

export function supplierEtag(row: Pick<SupplierRepresentation, "version">): string {
  return representationEtag(row.version, SUPPLIER_REPRESENTATION_REVISION);
}
