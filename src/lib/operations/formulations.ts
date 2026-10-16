import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createFormulationInTransaction, updateFormulationInTransaction, deleteFormulationInTransaction, lockFormulationTypes } from "@/data-access/formulation-writes";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { formulations } from "@/db/schema";
import { createFormulationInput, updateFormulationInput, deleteFormulationInput } from "@/schemas/formulation-input";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
const NOT_CHANGES = new Set(["formulationId", "expectedVersion"]);
function changedFields(input: object): string[] {
  return Object.entries(input).filter(([key, value]) => value !== undefined && !NOT_CHANGES.has(key)).map(([key]) => key).sort();
}
export const createFormulation: Operation<typeof createFormulationInput, FormulationWithIngredients> = {
  id: "create_formulation", input: createFormulationInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "created", entityType: "formulation", entityIds: [output.id], versionBefore: null, versionAfter: output.version, changedFields: changedFields(input) }),
  execute: async ({ ctx, tx }, input) => {
    await lockFormulationTypes(ctx, tx, input.lines);
    return withAutoCodes(ctx, tx, "BCF", formulations, formulations.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createFormulationInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.formulation);
  },
};
export const updateFormulation: Operation<typeof updateFormulationInput, FormulationWithIngredients> = {
  id: "update_formulation", input: updateFormulationInput, supportsDryRun: true,
  describe: (input, output) => ({ outcome: "updated", entityType: "formulation", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: changedFields(input) }),
  execute: ({ ctx, tx }, input) => updateFormulationInTransaction(ctx, tx, input),
};
export const deleteFormulation: Operation<typeof deleteFormulationInput, void> = {
  id: "delete_formulation", input: deleteFormulationInput, supportsDryRun: true,
  describe: input => ({ outcome: "deleted", entityType: "formulation", entityIds: [input.formulationId], versionBefore: input.expectedVersion, versionAfter: null, changedFields: [] }),
  execute: ({ ctx, tx }, input) => deleteFormulationInTransaction(ctx, tx, input),
};
