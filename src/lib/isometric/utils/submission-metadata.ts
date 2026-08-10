export const SUBMISSION_METADATA_KEYS = {
  remoteStatus: "remoteStatus",
  pendingTotalCo2eRemovedKg: "pendingTotalCo2eRemovedKg",
  removalIds: "removalIds",
  rejectionReason: "rejectionReason",
  lastError: "lastError",
  lastAttemptOutcome: "lastAttemptOutcome",
  externalMutation: "externalMutation",
} as const;

export function getMetadataValue(
  metadata: unknown,
  key: string,
): unknown {
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    key in metadata
  ) {
    return (metadata as Record<string, unknown>)[key];
  }
  return null;
}
