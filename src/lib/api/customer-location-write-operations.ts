import { CUSTOMER_LOCATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { partyArchivedForEdit, partyLocationNotFound, customerLocationArchivedForEdit } from "@/lib/party-domain-errors";
import { updateCustomerLocationApi, deleteCustomerLocationApi, archiveCustomerLocationApi, restoreCustomerLocationApi } from "@/lib/operations/party-location-api";
import type { OperationScope } from "@/lib/operations/runner";
import { readApiCustomer } from "@/lib/read-models/api-customers";
import { readApiCustomerLocation } from "@/lib/read-models/api-customer-locations";

async function checkRevision(scope: OperationScope, parentId: string, locationId: string, patch: boolean) {
  // Location first, scoped to org and parent, so a foreign or missing parent
  // answers at /locationId exactly as the writer does with a valid revision.
  const location = await readApiCustomerLocation(scope.ctx, parentId, locationId, scope.tx);
  if (!location) throw partyLocationNotFound("customer");
  const parent = await readApiCustomer(scope.ctx, { id: parentId }, scope.tx);
  if (parent.archivedAt) throw partyArchivedForEdit("customer", parent.code);
  if (patch && location.archivedAt) throw customerLocationArchivedForEdit(location.name);
  throw new DomainError("stale_version", "The representation has changed.");
}

/** Execute after idempotency replay; a valid revision leaves ordering to the locked writer. */
export function representationCheckedUpdate(parentId: string, locationId: string, revision: number): typeof updateCustomerLocationApi {
  return {
    ...updateCustomerLocationApi,
    execute: async (scope, input) => {
      if (revision !== CUSTOMER_LOCATION_REPRESENTATION_REVISION) await checkRevision(scope, parentId, locationId, true);
      return updateCustomerLocationApi.execute(scope, input);
    },
  };
}

/** Execute after idempotency replay; a valid revision leaves ordering to the locked writer. */
export function representationCheckedDelete(parentId: string, locationId: string, revision: number): typeof deleteCustomerLocationApi {
  return {
    ...deleteCustomerLocationApi,
    execute: async (scope, input) => {
      if (revision !== CUSTOMER_LOCATION_REPRESENTATION_REVISION) await checkRevision(scope, parentId, locationId, false);
      return deleteCustomerLocationApi.execute(scope, input);
    },
  };
}

export function representationCheckedTransition(parentId: string, locationId: string, revision: number, command: "archive" | "restore"): typeof archiveCustomerLocationApi {
  const operation = command === "archive" ? archiveCustomerLocationApi : restoreCustomerLocationApi;
  return {
    ...operation,
    execute: async (scope, input) => {
      if (revision !== CUSTOMER_LOCATION_REPRESENTATION_REVISION) await checkRevision(scope, parentId, locationId, false);
      return operation.execute(scope, input);
    },
  };
}
