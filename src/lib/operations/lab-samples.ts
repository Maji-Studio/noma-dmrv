import { CODE_CONFLICT_MESSAGES, withAutoCodes, withUniqueCodeGuard } from "@/data-access/code-generator";
import {
  createSampleInTransaction,
  deleteSampleInTransaction,
  updateSampleInTransaction,
  type SampleWriteResult,
} from "@/data-access/samples";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { samples } from "@/db/schema";
import { withSampleErrors } from "@/lib/sample-domain-errors";
import {
  deleteLabSampleInput, recordLabSampleInput, updateLabSampleInput,
  type DeleteLabSampleInput, type RecordLabSampleInput, type UpdateLabSampleInput,
} from "@/schemas/lab-sample-input";
import type { Operation } from "./runner";
import type { OperationDescription } from "@/lib/operation-effect";

/**
 * Lab Sample writes (Phase 5a): one replicate's lab results on one credit
 * batch. The Server Actions and the API run these same operations.
 *
 * A write's result carries the saved Sample, `notices` (each calculated
 * ratio, round 7 Q50) and `warnings` (what a registry submission will still
 * need, round 7 Q52 and Q53). Neither blocks the write.
 */

const AUTO_CODE_COUNT = 1;
const SAMPLE_CODE_PREFIX = "SAM";
const ENTITY_TYPE = "labSample";



interface SavedSample { id: string; version: number }

/** Audit effect of a create, shared with the API adapter that publishes the saved row instead. */
export function describeRecordedLabSample(input: RecordLabSampleInput, sample: SavedSample): OperationDescription {
  return {
    outcome: "created", entityType: ENTITY_TYPE, entityIds: [sample.id],
    versionBefore: null, versionAfter: sample.version,
  };
}

/** Audit effect of an update, shared with the API adapter. */
export function describeUpdatedLabSample(input: UpdateLabSampleInput, sample: SavedSample): OperationDescription {
  return {
    outcome: "updated", entityType: ENTITY_TYPE, entityIds: [sample.id],
    versionBefore: input.expectedVersion, versionAfter: sample.version,
  };
}

export const recordLabSample: Operation<typeof recordLabSampleInput, SampleWriteResult> = {
  id: "record_lab_sample",
  input: recordLabSampleInput,
  supportsDryRun: true,
  describe: (input, output) => describeRecordedLabSample(input, output.sample),
  // Each code attempt runs the whole create, locks included, in its own savepoint.
  execute: async ({ ctx, tx, activity }, input) => {
    const result = await withSampleErrors(() => withAutoCodes(
      ctx, tx, SAMPLE_CODE_PREFIX, samples, samples.sampleCode, AUTO_CODE_COUNT,
      ([sampleCode], savepoint) => createSampleInTransaction(ctx, savepoint, { ...input, sampleCode }, { capture: activity.capture }),
      CODE_CONFLICT_MESSAGES.sample,
    ));
    activity.link({ creditBatchId: result.sample.creditBatchId, productionRunId: result.sample.productionRunId });
    return result;
  },
};

export const updateLabSample: Operation<typeof updateLabSampleInput, SampleWriteResult> = {
  id: "update_lab_sample",
  input: updateLabSampleInput,
  supportsDryRun: true,
  describe: (input, output) => describeUpdatedLabSample(input, output.sample),
  execute: async ({ ctx, tx, activity }, { labSampleId, code, ...changes }) => {
    const result = await withSampleErrors(() => withUniqueCodeGuard(
      ctx, samples, samples.sampleCode, CODE_CONFLICT_MESSAGES.sample,
      () => updateSampleInTransaction(ctx, tx, labSampleId, { ...changes, sampleCode: code }, { capture: activity.capture }),
    ));
    activity.link({ creditBatchId: result.sample.creditBatchId, productionRunId: result.sample.productionRunId });
    return result;
  },
};

export const describeDeletedLabSample = (input: DeleteLabSampleInput): OperationDescription => ({
  outcome: "deleted", entityType: ENTITY_TYPE, entityIds: [input.labSampleId],
  versionBefore: input.expectedVersion, versionAfter: null,
});

export const deleteLabSample: Operation<typeof deleteLabSampleInput, void> = {
  id: "delete_lab_sample",
  input: deleteLabSampleInput,
  supportsDryRun: true,
  describe: describeDeletedLabSample,
  execute: async ({ ctx, tx, source, afterCommit, activity }, { labSampleId, expectedVersion }) => {
    const links = await withSampleErrors(() => deleteSampleInTransaction(ctx, tx, labSampleId, expectedVersion, source));
    // Retired documents queue their storage deletions; drain them only once committed.
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
    activity.link({ facilityId: links.facilityId, creditBatchId: links.creditBatchId, productionRunId: links.productionRunId });
  },
};
