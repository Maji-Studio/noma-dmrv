import type { ApiContext } from "@/lib/auth/api-context";
import { LAB_SAMPLE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import {
  deleteLabSample, describeDeletedLabSample, describeRecordedLabSample, describeUpdatedLabSample, recordLabSample, updateLabSample,
} from "@/lib/operations/lab-samples";
import type { Operation } from "@/lib/operations/runner";
import { readApiLabSample } from "@/lib/read-models/api-lab-samples";
import { labSampleRepresentationSchema, type LabSampleRepresentation } from "@/lib/representations/lab-samples";
import { deleteLabSampleInput, recordLabSampleInput, updateLabSampleInput } from "@/schemas/lab-sample-input";
import { ApiHttpError } from "./http-error";

/** The saved row as published, with the guidance the write produced. Stored as the idempotent outcome. */
export interface LabSampleWriteOutput {
  sample: LabSampleRepresentation;
  /** Calculated-ratio notices first, then certification warnings. */
  warnings: string[];
}

interface Guidance {
  notices: { message: string }[];
  warnings: string[];
}
const guidance = ({ notices, warnings }: Guidance) => [...notices.map((notice) => notice.message), ...warnings];

/**
 * Run the create and read the public projection inside the write transaction,
 * so saved, dry-run and replayed outcomes share one shape. The input is the
 * published body only. A missing, foreign or archived batch answers 404 on
 * `/creditBatchId` from the operation itself.
 */
export const representationCheckedRecord: Operation<typeof recordLabSampleInput, LabSampleWriteOutput> = {
  id: recordLabSample.id,
  input: recordLabSampleInput,
  supportsDryRun: true,
  describe: (input, output) => describeRecordedLabSample(input, output.sample),
  execute: async (scope, input) => {
    const saved = await recordLabSample.execute(scope, input);
    return { sample: await readApiLabSample(scope.ctx, { id: saved.sample.id }, scope.tx), warnings: guidance(saved) };
  },
};

async function checkRepresentation(scope: Parameters<typeof updateLabSample.execute>[0], id: string, revision: number) {
  const row = await readApiLabSample(scope.ctx, { id }, scope.tx);
  if (revision !== LAB_SAMPLE_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

export function representationCheckedUpdate(id: string, revision: number): Operation<typeof updateLabSampleInput, LabSampleWriteOutput> {
  return {
    ...updateLabSample,
    describe: (input, output) => describeUpdatedLabSample(input, output.sample),
    execute: async (scope, input) => {
      await checkRepresentation(scope, id, revision);
      const saved = await updateLabSample.execute(scope, input);
      return { sample: await readApiLabSample(scope.ctx, { id }, scope.tx), warnings: guidance(saved) };
    },
  };
}

/** Retain the deleted row in the outcome, so a dry run can show what would go. */
export function representationCheckedDelete(id: string, revision: number): Operation<typeof deleteLabSampleInput, LabSampleRepresentation> {
  return {
    ...deleteLabSample,
    describe: describeDeletedLabSample,
    execute: async (scope, input) => {
      const row = await checkRepresentation(scope, id, revision);
      await deleteLabSample.execute(scope, input);
      return row;
    },
  };
}

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof DomainError && error.code === "stale_version") {
      const current = await readApiLabSample(ctx, { id });
      throw new ApiHttpError(412, "stale_version", "The lab sample has changed. Read the current representation before retrying.", current);
    }
    throw error;
  }
}

/** Replays come back from JSON storage with keys reordered; the schema restores the published order. */
export function labSampleBody(output: LabSampleWriteOutput) {
  return { data: labSampleRepresentationSchema.parse(output.sample), ...(output.warnings.length ? { warnings: output.warnings } : {}) };
}
