import { getMetadataValue, SUBMISSION_METADATA_KEYS } from "./submission-metadata";

export type SubmittedOnState =
  | { kind: "submitted"; at: Date | string }
  /** Past DRAFT in the registry (submitted there directly or discovered by a sync) with no date recorded. */
  | { kind: "registryDiscovered" }
  | { kind: "never" };

/** Shown for a Removal or GHG Statement that has no submission yet. */
export const NOT_SUBMITTED_LABEL = "Not submitted";
/** Shown for a statement past DRAFT in the registry with no recorded submission date. */
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

type StatementLedgerRow = { metadata: unknown };

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
  // Past DRAFT in the registry but no recorded date: it was submitted there
  // (directly in Isometric, or discovered by a sync), whoever created it here.
  if (latestRow) {
    const status = getMetadataValue(latestRow.metadata, SUBMISSION_METADATA_KEYS.remoteStatus);
    if (typeof status === "string" && status !== "DRAFT") {
      return { kind: "registryDiscovered" };
    }
  }
  return { kind: "never" };
}
