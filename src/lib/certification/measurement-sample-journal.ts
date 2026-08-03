import { z } from "zod";
import { SafeError } from "@/lib/errors";

const journaledMeasurementSampleSchema = z.object({
  supplierReferenceId: z.string().min(1),
  measurementSampleId: z.string().min(1),
});

const measurementSampleJournalSchema = z.array(
  journaledMeasurementSampleSchema,
);

export type JournaledMeasurementSample = z.infer<
  typeof journaledMeasurementSampleSchema
>;

export function readJournaledMeasurementSamples(
  payloadSnapshot: unknown,
): JournaledMeasurementSample[] {
  if (
    payloadSnapshot === null ||
    Array.isArray(payloadSnapshot) ||
    typeof payloadSnapshot !== "object"
  ) {
    return [];
  }
  const journaled = (payloadSnapshot as Record<string, unknown>).journaled;
  if (journaled === undefined) return [];
  if (
    journaled === null ||
    Array.isArray(journaled) ||
    typeof journaled !== "object"
  ) {
    throw new SafeError(
      "The saved Removal submission is damaged. Start a new submission.",
    );
  }
  const raw = (journaled as Record<string, unknown>).measurementSamples;
  if (raw === undefined) return [];
  const parsed = measurementSampleJournalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SafeError(
      "The saved Removal submission is damaged. Start a new submission.",
    );
  }
  const supplierReferences = new Set<string>();
  const measurementSampleIds = new Set<string>();
  for (const entry of parsed.data) {
    if (
      supplierReferences.has(entry.supplierReferenceId) ||
      measurementSampleIds.has(entry.measurementSampleId)
    ) {
      throw new SafeError(
        "The saved Removal submission is damaged. Start a new submission.",
      );
    }
    supplierReferences.add(entry.supplierReferenceId);
    measurementSampleIds.add(entry.measurementSampleId);
  }
  return parsed.data;
}

export function addJournaledMeasurementSample(
  current: JournaledMeasurementSample[],
  next: JournaledMeasurementSample,
): JournaledMeasurementSample[] {
  const sameReference = current.find(
    (entry) => entry.supplierReferenceId === next.supplierReferenceId,
  );
  if (sameReference) {
    if (sameReference.measurementSampleId !== next.measurementSampleId) {
      throw new SafeError(
        `Submission ${next.supplierReferenceId} is linked to a different registry measurement. Start a new submission.`,
      );
    }
    return [...current].sort((left, right) =>
      left.supplierReferenceId.localeCompare(right.supplierReferenceId),
    );
  }
  const sameId = current.find(
    (entry) => entry.measurementSampleId === next.measurementSampleId,
  );
  if (sameId) {
    throw new SafeError(
      `Registry measurement ${next.measurementSampleId} is linked to a different submission. Start a new submission.`,
    );
  }
  return [...current, next].sort((left, right) =>
    left.supplierReferenceId.localeCompare(right.supplierReferenceId),
  );
}
