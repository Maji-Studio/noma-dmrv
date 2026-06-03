/**
 * SubmissionStatusBadge
 * Thin renderer over the canonical status mappers in `@/lib/certification/status`.
 * A Removal is local-only (no remote status exists in this integration); a GHG
 * Statement folds in the persisted remote overlay (`metadata.remoteStatus`) so
 * operators see "Awaiting verifier" / "Credits issued" rather than a flat
 * "Submitted". "In progress" derives from the lock-flight check.
 */
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  deriveRemovalStatus,
  deriveStatementStatus,
  type LocalSubmissionStatus,
  type RemoteGhgStatus,
} from "@/lib/certification/status";
import {
  getMetadataValue,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/isometric/utils/submission-metadata";

interface SubmissionStatusBadgeProps {
  latest: CertificationSubmissionRow | null;
  isLockedInFlight: boolean;
  /**
   * Which lifecycle to render. Removals are local-only; statements add the
   * verifier overlay. Defaults to "removal" for backward compatibility.
   */
  artifact?: "removal" | "ghgStatement";
}

const REMOTE_GHG_STATUSES: readonly RemoteGhgStatus[] = [
  "DRAFT",
  "AWAITING_VERIFICATION",
  "VERIFIED",
  "CREDITS_ISSUED",
  "FAILED_VERIFICATION",
];

function readRemoteStatus(
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

export function SubmissionStatusBadge({
  latest,
  isLockedInFlight,
  artifact = "removal",
}: SubmissionStatusBadgeProps) {
  const local = (latest?.status ?? null) as LocalSubmissionStatus | null;

  const derived =
    artifact === "ghgStatement"
      ? deriveStatementStatus({
          local,
          lockInFlight: isLockedInFlight,
          remoteStatus: latest ? readRemoteStatus(latest) : null,
        })
      : deriveRemovalStatus({ local, lockInFlight: isLockedInFlight });

  return <StatusBadge status={derived.value} label={derived.label} />;
}
