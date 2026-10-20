import { REGISTRY_DISCOVERY_SOURCE } from "./submission-source";
import { getMetadataValue, SUBMISSION_METADATA_KEYS } from "./submission-metadata";

export type SubmittedOnState =
  | { kind: "submitted"; at: Date | string }
  /** Already submitted in the registry before noma synced it, with no date recorded. */
  | { kind: "registryDiscovered" }
  | { kind: "never" };

/** Shown for a Removal or GHG Statement that has no submission yet. */
export const NOT_SUBMITTED_LABEL = "Not submitted";
/** Shown for a statement the registry already held as submitted, with no date recorded. */
export const REGISTRY_SUBMITTED_LABEL = "Submitted in Isometric";

/** A Removal's submission date is its ledger `submitted_at`. */
export function submittedOnState(
  submission: { submittedAt: Date | string | null } | null,
): SubmittedOnState {
  if (submission === null || submission.submittedAt === null) {
    return { kind: "never" };
  }
  return { kind: "submitted", at: submission.submittedAt };
}

type StatementLedgerRow = { payloadSnapshot: unknown; metadata: unknown };

function isRegistryDiscovered(row: StatementLedgerRow): boolean {
  const snapshot = row.payloadSnapshot;
  if (typeof snapshot !== "object" || snapshot === null || !("semantic" in snapshot)) {
    return false;
  }
  const semantic = snapshot.semantic;
  return (
    typeof semantic === "object" &&
    semantic !== null &&
    "source" in semantic &&
    semantic.source === REGISTRY_DISCOVERY_SOURCE
  );
}

/**
 * A GHG Statement's ledger `submitted_at` stamps registry CREATION (the remote
 * statement is still a draft). The real submission, and each resubmission, is
 * the recorded `metadata.submittedToVerifierAt`.
 *
 * @param verifierRow latest ledger row that records `submittedToVerifierAt`
 * @param latestRow latest ledger row, used only when no date is recorded
 */
export function statementSubmittedOnState(
  verifierRow: StatementLedgerRow | null,
  latestRow: StatementLedgerRow | null,
): SubmittedOnState {
  const recorded = verifierRow
    ? getMetadataValue(verifierRow.metadata, SUBMISSION_METADATA_KEYS.submittedToVerifierAt)
    : null;
  if (typeof recorded === "string" && Number.isFinite(Date.parse(recorded))) {
    return { kind: "submitted", at: recorded };
  }
  if (latestRow && isRegistryDiscovered(latestRow)) {
    const status = getMetadataValue(latestRow.metadata, SUBMISSION_METADATA_KEYS.remoteStatus);
    if (typeof status === "string" && status !== "DRAFT") {
      return { kind: "registryDiscovered" };
    }
  }
  return { kind: "never" };
}
