export const SUBMISSION_METADATA_KEYS = {
  evidenceRefreshCandidates: "evidenceRefreshCandidates",
  remoteStatus: "remoteStatus",
  pendingTotalCo2eRemovedKg: "pendingTotalCo2eRemovedKg",
  removalIds: "removalIds",
  rejectionReason: "rejectionReason",
  lastError: "lastError",
  lastAttemptOutcome: "lastAttemptOutcome",
  externalMutation: "externalMutation",
  // Written by Removal deletion. A ledger row carrying it describes registry
  // records that no longer exist, so its snapshot is history only and pins
  // nothing (document mirrors, reviewed evidence).
  deletion: "deletion",
} as const;

export const SUBMISSION_ATTEMPT_OUTCOMES = {
  interrupted: "interrupted",
  // Registry cleanup is running for a Removal deletion. Not "interrupted", so
  // the reclaim bypass stays closed and a concurrent submit waits for the
  // lock TTL instead of racing the DELETE calls.
  deleting: "deleting",
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

/** Only a proven mutation-free attempt can rebuild version-specific registry inputs. */
export function canRefreshSubmissionEvidence(metadata: unknown): boolean {
  return getMetadataValue(metadata, SUBMISSION_METADATA_KEYS.externalMutation) ===
    SUBMISSION_EXTERNAL_MUTATIONS.none;
}
