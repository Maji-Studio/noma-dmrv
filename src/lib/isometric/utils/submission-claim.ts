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

export interface SubmissionClaimInput {
  latest: SubmissionClaimRow | null;
  payloadHash: string;
  /** Injected for determinism; pass `Date.now()`. */
  now: number;
  /** Lock TTL in ms; pass `LOCK_TTL_MS` from the data-access layer. */
  lockTtlMs: number;
  policy: SubmissionClaimPolicy;
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
        | "after-superseded";
    }
  | { kind: "resume"; resumeRowId: string; resumeVersion: number }
  | { kind: "return-existing"; externalId: string; version: number }
  | { kind: "blocked-in-flight" }
  | { kind: "blocked-rejected-with-external" }
  | { kind: "invalid-changed-hash" };

export function decideSubmissionClaim(
  input: SubmissionClaimInput,
): SubmissionClaim {
  const { latest, payloadHash, now, lockTtlMs, policy } = input;

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
      const lockedAtMs = latest.lockedAt?.getTime() ?? 0;
      if (now - lockedAtMs < lockTtlMs) {
        return { kind: "blocked-in-flight" };
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

function assertNever(x: never): never {
  throw new Error(`Unhandled submission status: ${String(x)}`);
}
