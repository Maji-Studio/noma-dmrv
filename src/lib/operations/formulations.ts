import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createFormulationInTransaction, updateFormulationInTransaction, deleteFormulationInTransaction, archiveFormulationInTransaction, restoreFormulationInTransaction, lockFormulationTypes } from "@/data-access/formulation-writes";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { formulations } from "@/db/schema";
import { createFormulationInput, updateFormulationInput, formulationVersionInput } from "@/schemas/formulation-input";
import type { OperationEffect } from "@/lib/operation-effect";
import type { CreateFormulationInput, UpdateFormulationInput, FormulationVersionInput } from "@/schemas/formulation-input";
import { changedFields } from "./changed-fields";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
export const describeCreateFormulation = (input: CreateFormulationInput, output: Pick<FormulationWithIngredients, "id" | "version">): OperationEffect => ({ outcome: "created", entityType: "formulation", entityIds: [output.id], versionBefore: null, versionAfter: output.version, changedFields: changedFields(input) });
export const describeUpdateFormulation = (input: UpdateFormulationInput, output: Pick<FormulationWithIngredients, "id" | "version">): OperationEffect => ({ outcome: "updated", entityType: "formulation", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: changedFields(input) });
export const describeArchiveFormulation = (input: FormulationVersionInput, output: Pick<FormulationWithIngredients, "id" | "version">): OperationEffect => ({ outcome: "status_changed", fromStatus: "active", toStatus: "archived", entityType: "formulation", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: [] });
export const describeRestoreFormulation = (input: FormulationVersionInput, output: Pick<FormulationWithIngredients, "id" | "version">): OperationEffect => ({ outcome: "status_changed", fromStatus: "archived", toStatus: "active", entityType: "formulation", entityIds: [output.id], versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: [] });
export const createFormulation: Operation<typeof createFormulationInput, FormulationWithIngredients> = {
  id: "create_formulation", input: createFormulationInput, supportsDryRun: true,
  describe: describeCreateFormulation,
  execute: async ({ ctx, tx }, input) => {
    await lockFormulationTypes(ctx, tx, input.lines);
    return withAutoCodes(ctx, tx, "BCF", formulations, formulations.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createFormulationInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.formulation);
  },
};
export const updateFormulation: Operation<typeof updateFormulationInput, FormulationWithIngredients> = {
  id: "update_formulation", input: updateFormulationInput, supportsDryRun: true,
  describe: describeUpdateFormulation,
  execute: ({ ctx, tx }, input) => updateFormulationInTransaction(ctx, tx, input),
};
export const deleteFormulation: Operation<typeof formulationVersionInput, void> = {
  id: "delete_formulation", input: formulationVersionInput, supportsDryRun: true,
  describe: input => ({ outcome: "deleted", entityType: "formulation", entityIds: [input.formulationId], versionBefore: input.expectedVersion, versionAfter: null, changedFields: [] }),
  execute: ({ ctx, tx }, input) => deleteFormulationInTransaction(ctx, tx, input),
};

export const archiveFormulation: Operation<typeof formulationVersionInput, FormulationWithIngredients> = {
  id: "archive_formulation", input: formulationVersionInput, supportsDryRun: true,
  describe: describeArchiveFormulation,
  execute: ({ ctx, tx }, input) => archiveFormulationInTransaction(ctx, tx, input),
};

export const restoreFormulation: Operation<typeof formulationVersionInput, FormulationWithIngredients> = {
  id: "restore_formulation", input: formulationVersionInput, supportsDryRun: true,
  describe: describeRestoreFormulation,
  execute: ({ ctx, tx }, input) => restoreFormulationInTransaction(ctx, tx, input),
};
