import { SUPPLIER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { partyArchivedForEdit } from "@/lib/party-domain-errors";
import { archiveSupplierApi, restoreSupplierApi, updateSupplierApi } from "@/lib/operations/supplier-api";
import { deleteSupplier } from "@/lib/operations/suppliers";
import type { Operation } from "@/lib/operations/runner";
import { readApiSupplier } from "@/lib/read-models/api-suppliers";
import type { SupplierRepresentation } from "@/lib/representations/suppliers";

type Scope = Parameters<typeof updateSupplierApi.execute>[0];
async function checkRevision(scope: Scope, id: string, revision: number) {
  const row = await readApiSupplier(scope.ctx, { id }, scope.tx);
  if (revision !== SUPPLIER_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

/** Execute only after idempotency replay. The writer checks archive state before row version. */
export function representationCheckedUpdate(id: string, revision: number): typeof updateSupplierApi {
  return {
    ...updateSupplierApi,
    execute: async (scope, input) => {
      if (revision !== SUPPLIER_REPRESENTATION_REVISION) {
        const row = await readApiSupplier(scope.ctx, { id }, scope.tx);
        if (row.archivedAt) throw partyArchivedForEdit("supplier", row.code);
        throw new DomainError("stale_version", "The representation has changed.");
      }
      return updateSupplierApi.execute(scope, input);
    },
  };
}

/** Keep the deleted representation in the outcome for dry runs and durable replay. */
export function representationCheckedDelete(id: string, revision: number): Operation<typeof deleteSupplier.input, SupplierRepresentation> {
  return {
    ...deleteSupplier,
    describe: input => deleteSupplier.describe!(input, undefined),
    execute: async (scope, input) => {
      const row = await checkRevision(scope, id, revision);
      await deleteSupplier.execute(scope, input);
      return row;
    },
  };
}

export function representationCheckedTransition(id: string, revision: number, command: "archive" | "restore"): typeof archiveSupplierApi {
  const operation = command === "archive" ? archiveSupplierApi : restoreSupplierApi;
  return {
    ...operation,
    execute: async (scope, input) => {
      // A valid revision leaves existence, version and state ordering to the locked writer.
      if (revision !== SUPPLIER_REPRESENTATION_REVISION) await checkRevision(scope, id, revision);
      return operation.execute(scope, input);
    },
  };
}
