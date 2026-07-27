export type RemovalEvidenceHealthState =
  | "verified"
  | "awaiting_sync"
  | "mismatch";

export interface StoredSourceBindingVerification {
  submissionId: string;
  submissionVersion: number;
  state: RemovalEvidenceHealthState;
  checkedAt: string;
  verifiedCount: number;
  totalCount: number;
}

export interface RemovalEvidenceHealth {
  state: RemovalEvidenceHealthState;
  label: "Verified" | "Awaiting sync" | "Mismatch";
  verifiedCount: number;
  totalCount: number;
}

const LABELS: Record<
  RemovalEvidenceHealthState,
  RemovalEvidenceHealth["label"]
> = {
  verified: "Verified",
  awaiting_sync: "Awaiting sync",
  mismatch: "Mismatch",
};

const POST_SUBMIT_STATUSES = new Set([
  "submitted",
  "accepted",
  "superseded",
]);

function storedVerification(
  metadata: unknown,
): StoredSourceBindingVerification | null {
  if (
    metadata === null ||
    Array.isArray(metadata) ||
    typeof metadata !== "object"
  ) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)
    .sourceBindingVerification;
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<StoredSourceBindingVerification>;
  if (
    typeof candidate.submissionId !== "string" ||
    typeof candidate.submissionVersion !== "number" ||
    (candidate.state !== "verified" &&
      candidate.state !== "awaiting_sync" &&
      candidate.state !== "mismatch") ||
    typeof candidate.checkedAt !== "string" ||
    typeof candidate.verifiedCount !== "number" ||
    typeof candidate.totalCount !== "number"
  ) {
    return null;
  }
  return candidate as StoredSourceBindingVerification;
}

export function deriveRemovalEvidenceHealth(args: {
  submissionId: string | null;
  submissionVersion: number | null;
  submissionStatus: string | null;
  removalMetadata: unknown;
}): RemovalEvidenceHealth | null {
  if (
    !args.submissionId ||
    args.submissionVersion === null ||
    !args.submissionStatus ||
    !POST_SUBMIT_STATUSES.has(args.submissionStatus)
  ) {
    return null;
  }
  const stored = storedVerification(args.removalMetadata);
  if (
    !stored ||
    stored.submissionId !== args.submissionId ||
    stored.submissionVersion !== args.submissionVersion
  ) {
    return {
      state: "awaiting_sync",
      label: LABELS.awaiting_sync,
      verifiedCount: 0,
      totalCount: 0,
    };
  }
  return {
    state: stored.state,
    label: LABELS[stored.state],
    verifiedCount: stored.verifiedCount,
    totalCount: stored.totalCount,
  };
}
