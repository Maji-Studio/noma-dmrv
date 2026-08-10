/**
 * Bridge from a persisted submission ledger row to a derived operator status.
 * The pure mappers in `./status` take primitives; this reads the remote-status
 * overlay off `metadata.remoteStatus` and calls the right mapper per artifact.
 * Shared by `SubmissionStatusBadge` and any surface that needs to filter/sort
 * rows by their derived status (Overview queue, Removals/GHG DataTables).
 *
 * Client-safe: the `CertificationSubmissionRow` import is type-only (erased);
 * `submission-metadata` is a pure util already used by client components.
 */

import type { CertificationSubmissionRow } from "@/data-access/certification";
import {
  getMetadataValue,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";
import {
  deriveRemovalStatus,
  isRemovalSubmissionInterrupted,
  deriveStatementStatus,
  type DerivedStatus,
  type LocalSubmissionStatus,
  type RemoteGhgStatus,
} from "./status";

export type CertificationArtifact = "removal" | "ghgStatement";

const REMOTE_GHG_STATUSES: readonly RemoteGhgStatus[] = [
  "DRAFT",
  "AWAITING_VERIFICATION",
  "VERIFIED",
  "CREDITS_ISSUED",
  "FAILED_VERIFICATION",
];

/** The persisted verifier status off a submission row, or null when absent. */
export function readRemoteStatus(
  latest: CertificationSubmissionRow,
): RemoteGhgStatus | null {
  const raw = getMetadataValue(
    latest.metadata,
    SUBMISSION_METADATA_KEYS.remoteStatus,
  );
  return REMOTE_GHG_STATUSES.includes(raw as RemoteGhgStatus)
    ? (raw as RemoteGhgStatus)
    : null;
}

/**
 * Derive the operator-facing status for a submission row. Removals are
 * local-only; GHG statements fold in the persisted remote overlay.
 */
export function deriveSubmissionStatus(
  latest: CertificationSubmissionRow | null,
  isLockedInFlight: boolean,
  artifact: CertificationArtifact,
): DerivedStatus {
  const local = (latest?.status ?? null) as LocalSubmissionStatus | null;
  if (artifact === "ghgStatement") {
    return deriveStatementStatus({
      local,
      lockInFlight: isLockedInFlight,
      remoteStatus: latest ? readRemoteStatus(latest) : null,
    });
  }
  return deriveRemovalStatus({
    local,
    lockInFlight: isLockedInFlight,
    submissionInterrupted: isRemovalSubmissionInterrupted(latest?.metadata),
  });
}
