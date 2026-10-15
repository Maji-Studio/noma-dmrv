import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createApplicationInTransaction, updateApplicationInTransaction, deleteApplicationInTransaction } from "@/data-access/application-writes";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { applications, type Application } from "@/db/schema";
import { recordApplicationInput, updateApplicationInput, deleteApplicationInput, type RecordApplicationInput, type UpdateApplicationInput } from "@/schemas/application-input";
import type { OperationEffect } from "@/lib/operation-effect";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;
const NOT_CHANGES = new Set(["applicationId", "expectedVersion"]);
function changedFields(input: object): string[] {
  return Object.entries(input).filter(([key, value]) => value !== undefined && !NOT_CHANGES.has(key)).map(([key]) => key).sort();
}

export const describeRecordedApplication = (input: RecordApplicationInput, output: Pick<Application, "id" | "version">): OperationEffect => ({ outcome: "created", entityType: "application", entityIds: [output.id],
    versionBefore: null, versionAfter: output.version, changedFields: changedFields(input) });
export const describeUpdatedApplication = (input: UpdateApplicationInput, output: Pick<Application, "id" | "version">): OperationEffect => ({ outcome: "updated", entityType: "application", entityIds: [output.id],
    versionBefore: input.expectedVersion, versionAfter: output.version, changedFields: changedFields(input) });

export const recordApplication: Operation<typeof recordApplicationInput, Application> = {
  id: "record_application", input: recordApplicationInput, supportsDryRun: true,
  describe: describeRecordedApplication,
  execute: async ({ ctx, tx }, input) => {
    return withAutoCodes(ctx, tx, "AP", applications, applications.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createApplicationInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.application);
  },
};

export const updateApplication: Operation<typeof updateApplicationInput, Application> = {
  id: "update_application", input: updateApplicationInput, supportsDryRun: true,
  describe: describeUpdatedApplication,
  execute: ({ ctx, tx }, input) => updateApplicationInTransaction(ctx, tx, input),
};

export const deleteApplication: Operation<typeof deleteApplicationInput, void> = {
  id: "delete_application", input: deleteApplicationInput, supportsDryRun: true,
  describe: (input) => ({ outcome: "deleted", entityType: "application", entityIds: [input.applicationId],
    versionBefore: input.expectedVersion, versionAfter: null, changedFields: [] }),
  execute: async ({ ctx, tx, afterCommit }, input) => {
    await deleteApplicationInTransaction(ctx, tx, input);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
  },
};
