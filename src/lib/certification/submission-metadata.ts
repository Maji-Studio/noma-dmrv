export const SUBMISSION_METADATA_KEYS = {
  remoteStatus: "remoteStatus",
  pendingTotalCo2eRemovedKg: "pendingTotalCo2eRemovedKg",
  removalIds: "removalIds",
  rejectionReason: "rejectionReason",
  lastError: "lastError",
  lastAttemptOutcome: "lastAttemptOutcome",
  externalMutation: "externalMutation",
} as const;

export const SUBMISSION_ATTEMPT_OUTCOMES = {
  interrupted: "interrupted",
} as const;

export const SUBMISSION_EXTERNAL_MUTATIONS = {
  none: "none",
  possible: "possible",
  confirmed: "confirmed",
} as const;

export function getMetadataValue(metadata: unknown, key: string): unknown {
  if (typeof metadata === "object" && metadata !== null && key in metadata) {
    return (metadata as Record<string, unknown>)[key];
  }
  return null;
}

export function isSubmissionAttemptInterrupted(metadata: unknown): boolean {
  return (
    getMetadataValue(metadata, SUBMISSION_METADATA_KEYS.lastAttemptOutcome) ===
    SUBMISSION_ATTEMPT_OUTCOMES.interrupted
  );
}

/** A finished attempt may bypass the lock TTL only after confirmed remote work. */
export function canReclaimInterruptedSubmission(metadata: unknown): boolean {
  return (
    isSubmissionAttemptInterrupted(metadata) &&
    getMetadataValue(metadata, SUBMISSION_METADATA_KEYS.externalMutation) ===
      SUBMISSION_EXTERNAL_MUTATIONS.confirmed
  );
}
