import { readApiFormulation } from "@/lib/read-models/api-formulations";
import type { FormulationRepresentation } from "@/lib/representations/formulations";
import { createFormulationInput, updateFormulationInput, formulationVersionInput } from "@/schemas/formulation-input";
import {
  createFormulation, updateFormulation, archiveFormulation, restoreFormulation,
  describeCreateFormulation, describeUpdateFormulation, describeArchiveFormulation, describeRestoreFormulation,
} from "./formulations";
import type { Operation } from "./runner";

type FormulationOutput = { formulation: FormulationRepresentation };

// App actions keep the full row operations; registered operations publish only the representation.
export const createFormulationApi: Operation<typeof createFormulationInput, FormulationOutput> = {
  ...createFormulation,
  describe: (input, output) => describeCreateFormulation(input, output.formulation),
  execute: async (scope, input) => {
    const row = await createFormulation.execute(scope, input);
    return { formulation: await readApiFormulation(scope.ctx, { id: row.id }, scope.tx) };
  },
};
export const updateFormulationApi: Operation<typeof updateFormulationInput, FormulationOutput> = {
  ...updateFormulation,
  describe: (input, output) => describeUpdateFormulation(input, output.formulation),
  execute: async (scope, input) => {
    const row = await updateFormulation.execute(scope, input);
    return { formulation: await readApiFormulation(scope.ctx, { id: row.id }, scope.tx) };
  },
};
export const archiveFormulationApi: Operation<typeof formulationVersionInput, FormulationOutput> = {
  ...archiveFormulation,
  describe: (input, output) => describeArchiveFormulation(input, output.formulation),
  execute: async (scope, input) => {
    const row = await archiveFormulation.execute(scope, input);
    return { formulation: await readApiFormulation(scope.ctx, { id: row.id }, scope.tx) };
  },
};
export const restoreFormulationApi: Operation<typeof formulationVersionInput, FormulationOutput> = {
  ...restoreFormulation,
  describe: (input, output) => describeRestoreFormulation(input, output.formulation),
  execute: async (scope, input) => {
    const row = await restoreFormulation.execute(scope, input);
    return { formulation: await readApiFormulation(scope.ctx, { id: row.id }, scope.tx) };
  },
};
