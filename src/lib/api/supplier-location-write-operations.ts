import { SUPPLIER_LOCATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { partyArchivedForEdit, partyLocationNotFound } from "@/lib/party-domain-errors";
import { updateSupplierLocationApi, deleteSupplierLocationApi } from "@/lib/operations/party-location-api";
import type { OperationScope } from "@/lib/operations/runner";
import { readApiSupplier } from "@/lib/read-models/api-suppliers";
import { readApiSupplierLocation } from "@/lib/read-models/api-supplier-locations";

async function checkRevision(scope: OperationScope, parentId: string, locationId: string) {
  // Location first, scoped to org and parent, so a foreign or missing parent
  // answers at /locationId exactly as the writer does with a valid revision.
  const location = await readApiSupplierLocation(scope.ctx, parentId, locationId, scope.tx);
  if (!location) throw partyLocationNotFound("supplier");
  const parent = await readApiSupplier(scope.ctx, { id: parentId }, scope.tx);
  if (parent.archivedAt) throw partyArchivedForEdit("supplier", parent.code);
  throw new DomainError("stale_version", "The representation has changed.");
}

/** Execute after idempotency replay; a valid revision leaves ordering to the locked writer. */
export function representationCheckedUpdate(parentId: string, locationId: string, revision: number): typeof updateSupplierLocationApi {
  return {
    ...updateSupplierLocationApi,
    execute: async (scope, input) => {
      if (revision !== SUPPLIER_LOCATION_REPRESENTATION_REVISION) await checkRevision(scope, parentId, locationId);
      return updateSupplierLocationApi.execute(scope, input);
    },
  };
}

/** Execute after idempotency replay; a valid revision leaves ordering to the locked writer. */
export function representationCheckedDelete(parentId: string, locationId: string, revision: number): typeof deleteSupplierLocationApi {
  return {
    ...deleteSupplierLocationApi,
    execute: async (scope, input) => {
      if (revision !== SUPPLIER_LOCATION_REPRESENTATION_REVISION) await checkRevision(scope, parentId, locationId);
      return deleteSupplierLocationApi.execute(scope, input);
    },
  };
}

