import { FORMULATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { formulationArchivedForEdit } from "@/lib/formulation-domain-errors";
import { archiveFormulationApi, restoreFormulationApi, updateFormulationApi } from "@/lib/operations/formulation-api";
import { deleteFormulation } from "@/lib/operations/formulations";
import type { Operation } from "@/lib/operations/runner";
import { readApiFormulation } from "@/lib/read-models/api-formulations";
import type { FormulationRepresentation } from "@/lib/representations/formulations";

type Scope = Parameters<typeof updateFormulationApi.execute>[0];
async function checkRevision(scope: Scope, id: string, revision: number) {
  const row = await readApiFormulation(scope.ctx, { id }, scope.tx);
  if (revision !== FORMULATION_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

/** Execute only after idempotency replay. The writer checks archive state before row version. */
export function representationCheckedUpdate(id: string, revision: number): typeof updateFormulationApi {
  return {
    ...updateFormulationApi,
    execute: async (scope, input) => {
      if (revision !== FORMULATION_REPRESENTATION_REVISION) {
        const row = await readApiFormulation(scope.ctx, { id }, scope.tx);
        if (row.archivedAt) throw formulationArchivedForEdit(row.code);
        throw new DomainError("stale_version", "The representation has changed.");
      }
      return updateFormulationApi.execute(scope, input);
    },
  };
}

/** Keep the deleted representation in the outcome for dry runs and durable replay. */
export function representationCheckedDelete(id: string, revision: number): Operation<typeof deleteFormulation.input, FormulationRepresentation> {
  return {
    ...deleteFormulation,
    describe: input => deleteFormulation.describe!(input, undefined),
    execute: async (scope, input) => {
      const row = await checkRevision(scope, id, revision);
      await deleteFormulation.execute(scope, input);
      return row;
    },
  };
}

export function representationCheckedTransition(id: string, revision: number, command: "archive" | "restore"): typeof archiveFormulationApi {
  const operation = command === "archive" ? archiveFormulationApi : restoreFormulationApi;
  return {
    ...operation,
    execute: async (scope, input) => {
      // A valid revision leaves existence, version and state ordering to the locked writer.
      if (revision !== FORMULATION_REPRESENTATION_REVISION) await checkRevision(scope, id, revision);
      return operation.execute(scope, input);
    },
  };
}
