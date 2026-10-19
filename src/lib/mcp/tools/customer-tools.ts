import { CUSTOMER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { withCurrentOnStale } from "@/lib/api/customer-write-checks";
import { representationCheckedTransition, representationCheckedUpdate } from "@/lib/api/customer-write-operations";
import { createCustomerApi } from "@/lib/operations/customer-api";
import { customerRepresentationSchema } from "@/lib/representations/customers";
import { updateCustomerApiInput, customerVersionInput } from "@/schemas/customer-input";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";

import { partyWriteTools } from "./party-tools";

export const customerWriteTools = partyWriteTools("customer", {
  idKey: "customerId",
  revision: CUSTOMER_REPRESENTATION_REVISION,
  create: createCustomerApi,
  updateInput: updateCustomerApiInput.extend(customerVersionInput.shape),
  versionInput: customerVersionInput,
  representation: customerRepresentationSchema,
  locationRepresentation: customerLocationRepresentationSchema,
  checkedUpdate: representationCheckedUpdate,
  checkedTransition: representationCheckedTransition,
  withCurrentOnStale,
});
