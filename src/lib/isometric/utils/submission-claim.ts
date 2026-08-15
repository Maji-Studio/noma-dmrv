/**
 * Pure submission-claim policy.
 *
 * Decides what to do when a caller wants to submit work for a given local
 * entity (credit batch, GHG period, ...): create a fresh version, resume an
 * unfinished draft, return an idempotent prior result, block, or reject.
 *
 * No I/O. No DB. Callers translate decisions into domain messages and side
 * effects.
 */

import {
  getMetadataValue,
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";

export type SubmissionClaimStatus =
  | "draft"
  | "submitted"
  | "accepted"
  | "rejected"
  | "superseded";

/**
 * Minimal structural shape consumed by the decision. The full
 * `CertificationSubmissionRow` from the data-access layer is structurally
 * compatible, so callers pass it directly without mapping.
 */
export interface SubmissionClaimRow {
  id: string;
  status: SubmissionClaimStatus;
  version: number;
  payloadHash: string | null;
  externalId: string | null;
  lockedAt: Date | null;
  metadata?: unknown;
}

export interface SubmissionClaimPolicy {
  /**
   * What to do when a `submitted` or `accepted` row exists with a different
   * payload hash:
   *   - `"supersede"`: bump version, mark previous as superseded (Removals).
   *   - `"invalid-changed-hash"`: reject; the upstream key is unique per
   *     period and a hash change here is a programmer error
   *     (GHG-statement creation: one row per `(project, end_on)`).
   */
  onSubmittedHashChanged: "supersede" | "invalid-changed-hash";
}

/**
 * Journaled per-step state from a prior dataUpload attempt
 * (ADR 0006 §3). Read off `payloadSnapshot` before the claim is
 * decided; absent for every other submission type. When supplied,
 * lets the `resume` branch refine into a step-specific recovery
 * action instead of restarting the whole pipeline.
 *
 * NOTE: `dataUploadSubmissionId` already lives on
 * `certificationSubmissions.externalId` once step 3 has succeeded.
 * Including it here covers the intermediate window where step 3
 * succeeded but the row update failed — `payloadSnapshot` is written
 * step-by-step inside the same server action, while `externalId` is
 * only stamped at the final `markSubmissionSubmitted` call.
 */
export interface DataUploadResumeSnapshot {
  dataUploadSubmissionId: string | null;
  fileUploadId: string | null;
  uploadUrlExpiresAt: Date | null;
  /** Last observed remote status, stored in ledger metadata. */
  remoteStatus?: "pending" | "completed" | "failed" | null;
}

export interface SubmissionClaimInput {
  latest: SubmissionClaimRow | null;
  payloadHash: string;
  /** Injected for determinism; pass `Date.now()`. */
  now: number;
  /** Lock TTL in ms; pass `LOCK_TTL_MS` from the data-access layer. */
  lockTtlMs: number;
  policy: SubmissionClaimPolicy;
  /**
   * Phase 5 Slice A — when present, the `resume` branch consults this
   * snapshot and may return a step-specific resume kind
   * (`resume-poll-existing`, `resume-re-put`) or, when the signed
   * upload URL has expired, an orphan-restart `create-new-version`.
   */
  dataUploadResume?: DataUploadResumeSnapshot;
}

export type SubmissionClaim =
  | {
      kind: "create-new-version";
      nextVersion: number;
      supersedePreviousId: string | null;
      reason:
        | "first"
        | "submitted-hash-changed"
        | "rejected-hash-changed"
        | "after-superseded"
        | "dataupload-orphan-restart"
        | "dataupload-rejected-restart";
    }
  | { kind: "resume"; resumeRowId: string; resumeVersion: number }
  | {
      kind: "resume-poll-existing";
      resumeRowId: string;
      resumeVersion: number;
      dataUploadSubmissionId: string;
    }
  | {
      kind: "resume-re-put";
      resumeRowId: string;
      resumeVersion: number;
      fileUploadId: string;
    }
  | { kind: "return-existing"; externalId: string; version: number }
  | { kind: "blocked-in-flight" }
  | { kind: "blocked-rejected-with-external" }
  | { kind: "invalid-changed-hash" };

/**
 * Headroom between "URL still valid" and "URL about to expire". A signed
 * upload URL with <30s of life left is treated as expired so the re-PUT
 * does not race a 403 from the storage backend.
 */
export const UPLOAD_URL_SAFETY_MS = 30_000;

export function isSubmissionClaimInterrupted(
  row: Pick<SubmissionClaimRow, "metadata"> | null,
): boolean {
  return (
    getMetadataValue(
      row?.metadata,
      SUBMISSION_METADATA_KEYS.lastAttemptOutcome,
    ) === SUBMISSION_ATTEMPT_OUTCOMES.interrupted
  );
}

export function decideSubmissionClaim(
  input: SubmissionClaimInput,
): SubmissionClaim {
  const { latest, payloadHash, now, lockTtlMs, policy, dataUploadResume } =
    input;

  if (latest === null) {
    return {
      kind: "create-new-version",
      nextVersion: 1,
      supersedePreviousId: null,
      reason: "first",
    };
  }

  switch (latest.status) {
    case "draft": {
      const interrupted = isSubmissionClaimInterrupted(latest);
      const lockedAtMs = latest.lockedAt?.getTime() ?? 0;
      // A synchronous failure marker proves the active process has ended. It
      // bypasses only the TTL: DataUpload still has to follow the journaled
      // recovery decision below, and the data-access CAS atomically requires
      // and clears the marker before recovery work can start.
      if (!interrupted && now - lockedAtMs < lockTtlMs) {
        return { kind: "blocked-in-flight" };
      }
      if (dataUploadResume) {
        // The journaled remote IDs (fileUpload, dataUploadSubmission) and the
        // signed upload URL were produced for `latest.payloadHash`. If the
        // source readings changed since (different hash), resuming would
        // re-PUT fresh bytes to a URL presigned for the old content length and
        // poll a submission built from stale data. Abandon the orphaned upload
        // and start a new version instead of reusing those IDs.
        if (latest.payloadHash === payloadHash) {
          return decideDataUploadResume({
            latest,
            dataUploadResume,
            now,
          });
        }
        return {
          kind: "create-new-version",
          nextVersion: latest.version + 1,
          supersedePreviousId: null,
          reason: "dataupload-orphan-restart",
        };
      }
      if (interrupted) {
        return {
          kind: "resume",
          resumeRowId: latest.id,
          resumeVersion: latest.version,
        };
      }
      return {
        kind: "resume",
        resumeRowId: latest.id,
        resumeVersion: latest.version,
      };
    }

    case "submitted":
    case "accepted": {
      if (latest.payloadHash === payloadHash && latest.externalId) {
        return {
          kind: "return-existing",
          externalId: latest.externalId,
          version: latest.version,
        };
      }
      if (policy.onSubmittedHashChanged === "supersede") {
        return {
          kind: "create-new-version",
          nextVersion: latest.version + 1,
          supersedePreviousId: latest.id,
          reason: "submitted-hash-changed",
        };
      }
      return { kind: "invalid-changed-hash" };
    }

    case "rejected": {
      if (dataUploadResume) {
        // A terminal remote failure needs an explicit operator-triggered new
        // version. Other submission types remain blocked because their remote
        // rejected artifact is the record that must be resolved.
        if (
          latest.externalId &&
          dataUploadResume.remoteStatus === "failed"
        ) {
          return {
            kind: "create-new-version",
            nextVersion: latest.version + 1,
            supersedePreviousId: latest.id,
            reason: "dataupload-rejected-restart",
          };
        }
        if (latest.externalId) {
          return decideDataUploadResume({ latest, dataUploadResume, now });
        }
        // A local failure may have happened after step 3 was journaled but
        // before externalId was finalized. Reconcile that ID instead of
        // minting a duplicate DataUploadSubmission.
        if (latest.payloadHash === payloadHash) {
          return decideDataUploadResume({ latest, dataUploadResume, now });
        }
      }
      if (latest.externalId) {
        return { kind: "blocked-rejected-with-external" };
      }
      if (latest.payloadHash === payloadHash) {
        return {
          kind: "resume",
          resumeRowId: latest.id,
          resumeVersion: latest.version,
        };
      }
      return {
        kind: "create-new-version",
        nextVersion: latest.version + 1,
        supersedePreviousId: null,
        reason: "rejected-hash-changed",
      };
    }

    case "superseded":
      return {
        kind: "create-new-version",
        nextVersion: latest.version + 1,
        supersedePreviousId: null,
        reason: "after-superseded",
      };

    default:
      return assertNever(latest.status);
  }
}

function decideDataUploadResume(args: {
  latest: SubmissionClaimRow;
  dataUploadResume: DataUploadResumeSnapshot;
  now: number;
}): SubmissionClaim {
  const { latest, dataUploadResume, now } = args;

  // Step 3 (or its response) succeeded: prefer the journaled id, fall
  // back to the row's externalId (which is only stamped at
  // markSubmissionSubmitted, AFTER step 3 returns).
  const dataUploadSubmissionId =
    dataUploadResume.dataUploadSubmissionId ?? latest.externalId;
  if (dataUploadSubmissionId) {
    return {
      kind: "resume-poll-existing",
      resumeRowId: latest.id,
      resumeVersion: latest.version,
      dataUploadSubmissionId,
    };
  }

  // Step 1 succeeded but step 3 did not. Re-PUT to the same signed
  // URL if it has enough headroom; otherwise the FileUpload is an
  // orphan (per ADR 0006 §6) and we restart with a new version.
  if (dataUploadResume.fileUploadId) {
    const expiresMs = dataUploadResume.uploadUrlExpiresAt?.getTime() ?? 0;
    const urlFresh = expiresMs > now + UPLOAD_URL_SAFETY_MS;
    if (urlFresh) {
      return {
        kind: "resume-re-put",
        resumeRowId: latest.id,
        resumeVersion: latest.version,
        fileUploadId: dataUploadResume.fileUploadId,
      };
    }
    return {
      kind: "create-new-version",
      nextVersion: latest.version + 1,
      supersedePreviousId: null,
      reason: "dataupload-orphan-restart",
    };
  }

  // Nothing journaled — the draft locked but step 1 never ran.
  // Resume the same row from the top.
  return {
    kind: "resume",
    resumeRowId: latest.id,
    resumeVersion: latest.version,
  };
}

function assertNever(x: never): never {
  throw new Error(`Unhandled submission status: ${String(x)}`);
}
