import { applicationWriteEnvelopeSchema } from "@/lib/representations/application-writes";
import { deleteApplication, describeRecordedApplication, describeUpdatedApplication } from "@/lib/operations/applications";
import type { ApiContext } from "@/lib/auth/api-context";
import { APPLICATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { recordApplicationApi, updateApplicationApi } from "@/lib/operations/application-api";
import type { Operation } from "@/lib/operations/runner";
import type { ApplicationOperationOutput } from "@/data-access/application-operation-output";
import { readApiApplication } from "@/lib/read-models/api-applications";
import type { ApplicationRepresentation } from "@/lib/representations/applications";
import { withCurrentOnStale as withCurrentOnStaleRepresentation } from "./write-checks";

interface ApplicationWriteOutput extends Omit<ApplicationOperationOutput, "application"> { application: ApplicationRepresentation }
export const representationCheckedRecord: Operation<typeof recordApplicationApi.input, ApplicationWriteOutput> = {
  ...recordApplicationApi,
  describe: (input, output) => describeRecordedApplication(input, output.application),
  execute: async (scope, input) => {
    const saved = await recordApplicationApi.execute(scope, input);
    return { ...saved, application: await readApiApplication(scope.ctx, { id: saved.application.id }, scope.tx) };
  },
};
function checkRevision(revision: number) {
  if (revision !== APPLICATION_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
}
export function representationCheckedUpdate(id: string, revision: number): Operation<typeof updateApplicationApi.input, ApplicationWriteOutput> {
  return {
    ...updateApplicationApi,
    describe: (input, output) => describeUpdatedApplication(input, output.application),
    execute: async (scope, input) => {
      checkRevision(revision);
      const saved = await updateApplicationApi.execute(scope, input);
      return { ...saved, application: await readApiApplication(scope.ctx, { id }, scope.tx) };
    },
  };
}
export function representationCheckedDelete(id: string, revision: number): Operation<typeof deleteApplication.input, ApplicationRepresentation> {
  return {
    ...deleteApplication, describe: input => deleteApplication.describe!(input, undefined),
    execute: async (scope, input) => {
      const current = await readApiApplication(scope.ctx, { id }, scope.tx);
      checkRevision(revision);
      await deleteApplication.execute(scope, input);
      return current;
    },
  };
}
export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  return withCurrentOnStaleRepresentation(fn, { noun: "application", readCurrent: () => readApiApplication(ctx, { id }) });
}
export function applicationBody(output: ApplicationWriteOutput) {
  return applicationWriteEnvelopeSchema.parse({ data: output.application, allocations: output.allocations,
    deliveryBalance: output.deliveryBalance, ...(output.warnings.length ? { warnings: output.warnings } : {}) });
}
