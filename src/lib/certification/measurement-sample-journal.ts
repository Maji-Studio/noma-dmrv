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
      "The Removal measurement-sample journal is invalid; retry is blocked.",
    );
  }
  const raw = (journaled as Record<string, unknown>).measurementSamples;
  if (raw === undefined) return [];
  const parsed = measurementSampleJournalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SafeError(
      "The Removal measurement-sample journal is invalid; retry is blocked.",
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
        "The Removal measurement-sample journal is invalid; retry is blocked.",
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
        `Supplier reference "${next.supplierReferenceId}" is already journaled to a different measurement sample.`,
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
      `Measurement sample "${next.measurementSampleId}" is already journaled to a different supplier reference.`,
    );
  }
  return [...current, next].sort((left, right) =>
    left.supplierReferenceId.localeCompare(right.supplierReferenceId),
  );
}
