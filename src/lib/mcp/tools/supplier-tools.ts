import { SUPPLIER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { withCurrentOnStale } from "@/lib/api/supplier-write-checks";
import { representationCheckedDelete, representationCheckedTransition, representationCheckedUpdate } from "@/lib/api/supplier-write-operations";
import { createSupplierApi } from "@/lib/operations/supplier-api";
import { supplierRepresentationSchema } from "@/lib/representations/suppliers";
import { updateSupplierApiInput, supplierVersionInput } from "@/schemas/supplier-input";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";

import { partyWriteTools } from "./party-tools";

export const supplierWriteTools = partyWriteTools("supplier", {
  idKey: "supplierId",
  revision: SUPPLIER_REPRESENTATION_REVISION,
  create: createSupplierApi,
  updateInput: updateSupplierApiInput.extend(supplierVersionInput.shape),
  versionInput: supplierVersionInput,
  representation: supplierRepresentationSchema,
  locationRepresentation: supplierLocationRepresentationSchema,
  checkedUpdate: representationCheckedUpdate,
  checkedDelete: representationCheckedDelete,
  checkedTransition: representationCheckedTransition,
  withCurrentOnStale,
});
