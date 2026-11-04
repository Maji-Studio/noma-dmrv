import type { certificationSubmissions } from "@/db/schema/certification";
import { readRemovalEntrySnapshot } from "@/lib/certification/removal-entry-snapshot";
import { getMetadataValue, SUBMISSION_METADATA_KEYS, SUBMISSION_EXTERNAL_MUTATIONS } from "@/lib/certification/submission-metadata";

/** A crashed, unreserved draft must not hide fresh facts from reads or the resume gate. */
export function frozenEntriesForAttempt<T extends { entries: readonly { id: string; sendReservedBySubmissionId: string | null }[]; productionReservationSubmissionId?: string | null }>(submission: typeof certificationSubmissions.$inferSelect | null, context: { batchFacts: Record<string, T>; carryContext?: { entries: readonly { id: string; sendReservedBySubmissionId: string | null }[] } }) {
  const { batchFacts: facts, carryContext } = context;
  if (!submission || submission.status !== "draft" || !submission.payloadSnapshot ||
    typeof submission.payloadSnapshot !== "object" || !("frozenEntrySet" in submission.payloadSnapshot)) return undefined;
  const frozen = readRemovalEntrySnapshot(submission).frozenEntrySet;
  const entries = [...Object.values(facts).flatMap((batch) => batch.entries),
    ...(carryContext?.entries ?? [])];
  // Both claim sets commit together, so production ownership also freezes an empty entry set.
  const productionReserved = Object.values(facts).some((batch) => batch.productionReservationSubmissionId === submission.id);
  const reserved = productionReserved || frozen.length > 0 && frozen.every((item) => entries.some((entry) =>
    entry.id === item.entryId && entry.sendReservedBySubmissionId === submission.id));
  const mutation = getMetadataValue(submission.metadata, SUBMISSION_METADATA_KEYS.externalMutation);
  return reserved || mutation === SUBMISSION_EXTERNAL_MUTATIONS.possible || mutation === SUBMISSION_EXTERNAL_MUTATIONS.confirmed ? frozen : undefined;
}
