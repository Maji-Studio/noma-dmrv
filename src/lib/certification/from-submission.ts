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
  isRemovalSubmissionInterruptedForReportingWindow,
  deriveStatementStatus,
  type DerivedStatus,
  type LocalSubmissionStatus,
  type RemovalReportingWindowDates,
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

function readSnapshotReportingWindow(
  latest: CertificationSubmissionRow | null,
): RemovalReportingWindowDates | "unknown" {
  const semantic = (latest?.payloadSnapshot as {
    semantic?: { startedOn?: unknown; completedOn?: unknown };
  } | null)?.semantic;
  if (
    typeof semantic?.startedOn !== "string" ||
    typeof semantic.completedOn !== "string"
  ) {
    return "unknown";
  }
  const startedOn = new Date(semantic.startedOn);
  const completedOn = new Date(semantic.completedOn);
  if (Number.isNaN(startedOn.getTime()) || Number.isNaN(completedOn.getTime())) {
    return "unknown";
  }
  return {
    startedOn: startedOn.toISOString().slice(0, 10),
    completedOn: completedOn.toISOString().slice(0, 10),
  };
}

export function isRemovalSubmissionInterruptedFromSubmission(
  latest: CertificationSubmissionRow | null,
  reportingWindow: RemovalReportingWindowDates | "unknown",
): boolean {
  const local = (latest?.status ?? null) as LocalSubmissionStatus | null;
  if (
    isRemovalSubmissionInterruptedForReportingWindow({
      local,
      metadata: latest?.metadata,
      reportingWindow,
    })
  ) {
    return true;
  }
  const snapshotWindow = readSnapshotReportingWindow(latest);
  return (
    local === "submitted" &&
    reportingWindow !== "unknown" &&
    snapshotWindow !== "unknown" &&
    (reportingWindow.startedOn !== snapshotWindow.startedOn ||
      reportingWindow.completedOn !== snapshotWindow.completedOn)
  );
}

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
 * Overlay a live-fetched registry status onto a submission row copy, so every
 * surface fed from one response derives from the same registry state. The
 * persisted `metadata.remoteStatus` is only written by explicit operator
 * actions (sync, refresh, submit) — a detail view that also fetched the live
 * statement must not show a badge from the stale overlay next to raw state
 * from the fresh fetch (DR-002 / #685). Pure copy; never writes back.
 */
export function overlayLiveRemoteStatus<
  T extends CertificationSubmissionRow,
>(latest: T, liveRemoteStatus: string | null | undefined): T {
  if (
    !liveRemoteStatus ||
    !REMOTE_GHG_STATUSES.includes(liveRemoteStatus as RemoteGhgStatus)
  ) {
    return latest;
  }
  const metadata =
    latest.metadata && typeof latest.metadata === "object"
      ? (latest.metadata as Record<string, unknown>)
      : {};
  if (metadata[SUBMISSION_METADATA_KEYS.remoteStatus] === liveRemoteStatus) {
    return latest;
  }
  return {
    ...latest,
    metadata: {
      ...metadata,
      [SUBMISSION_METADATA_KEYS.remoteStatus]: liveRemoteStatus,
    },
  };
}

/**
 * Derive the operator-facing status for a submission row. Removals are
 * local-only; GHG statements fold in the persisted remote overlay.
 */
export function deriveSubmissionStatus(
  latest: CertificationSubmissionRow | null,
  isLockedInFlight: boolean,
  artifact: CertificationArtifact,
  reportingWindow: RemovalReportingWindowDates | "unknown",
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
    submissionInterrupted: isRemovalSubmissionInterruptedFromSubmission(
      latest,
      reportingWindow,
    ),
  });
}
