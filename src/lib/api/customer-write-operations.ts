import { CUSTOMER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { partyArchivedForEdit } from "@/lib/party-domain-errors";
import { archiveCustomerApi, restoreCustomerApi, updateCustomerApi, deleteCustomerApi } from "@/lib/operations/customer-api";
import { readApiCustomer } from "@/lib/read-models/api-customers";

type Scope = Parameters<typeof updateCustomerApi.execute>[0];
async function checkRevision(scope: Scope, id: string, revision: number) {
  const row = await readApiCustomer(scope.ctx, { id }, scope.tx);
  if (revision !== CUSTOMER_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

/** Execute only after idempotency replay. The writer checks archive state before row version. */
export function representationCheckedUpdate(id: string, revision: number): typeof updateCustomerApi {
  return {
    ...updateCustomerApi,
    execute: async (scope, input) => {
      if (revision !== CUSTOMER_REPRESENTATION_REVISION) {
        const row = await readApiCustomer(scope.ctx, { id }, scope.tx);
        if (row.archivedAt) throw partyArchivedForEdit("customer", row.code);
        throw new DomainError("stale_version", "The representation has changed.");
      }
      return updateCustomerApi.execute(scope, input);
    },
  };
}

/** REST keeps the customer and cascade in the outcome for dry runs and replay. */
export function representationCheckedCascadeDelete(id: string, revision: number): typeof deleteCustomerApi {
  return {
    ...deleteCustomerApi,
    execute: async (scope, input) => {
      if (revision !== CUSTOMER_REPRESENTATION_REVISION) await checkRevision(scope, id, revision);
      return deleteCustomerApi.execute(scope, input);
    },
  };
}

export function representationCheckedTransition(id: string, revision: number, command: "archive" | "restore"): typeof archiveCustomerApi {
  const operation = command === "archive" ? archiveCustomerApi : restoreCustomerApi;
  return {
    ...operation,
    execute: async (scope, input) => {
      // A valid revision leaves existence, version and state ordering to the locked writer.
      if (revision !== CUSTOMER_REPRESENTATION_REVISION) await checkRevision(scope, id, revision);
      return operation.execute(scope, input);
    },
  };
}
