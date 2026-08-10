/**
 * Certification status model — the single source of truth every surface
 * (badge, work queue, side-sheet, DataTable column) derives an operator-facing
 * status from. Pure and **strictly client-safe**: NO runtime import of the
 * Drizzle schema (`db/schema`) or the server Isometric client
 * (`lib/isometric/*` runtime modules). The remote GHG union is a **type-only**
 * import from the generated OpenAPI types, which is erased at build time.
 *
 * Two artifacts, two lifecycles (see `CONTEXT.md`, ADR 0003/0004):
 *
 *   - **Removal** → submitted to the **registry**. Single-phase `submitRemoval`.
 *     There is NO remote Removal status in this integration, so the lifecycle
 *     ends at "Submitted". A latest `superseded` row is a retired attempt with
 *     no current version and must remain actionable; successful re-versioning
 *     exposes the newer `submitted` row instead.
 *
 *   - **GHG Statement** → submitted to a **verifier**. One linear ladder
 *     (#250): Draft → In registry → In verification → Verified → Issued (with
 *     Verification failed off the verifier arm). The verifier lifecycle beyond
 *     "In registry" is read from the persisted submission metadata
 *     (`metadata.remoteStatus`) — never a per-row live fetch. "Submitted" is
 *     deliberately absent: it collided with the "Submit to verifier" action
 *     (it meant "created in the registry", not "sent to the verifier").
 */

import type { StatusValue } from "@/components/ui/status-badge";
// Type-only — erased at build time, so the generated types never reach the
// client bundle as runtime code.
import type { components } from "@/lib/isometric/generated/certify";
import {
  getMetadataValue,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";
import type { RemovalReadiness } from "./readiness";

/**
 * Local certification-submission ledger status. Mirrors the DB enum in
 * `src/db/schema/common.ts` (`certificationSubmissionStatus`); declared
 * locally so this module imports no server/schema runtime code.
 */
export type LocalSubmissionStatus =
  | "draft"
  | "submitted"
  | "accepted"
  | "rejected"
  | "superseded";

/**
 * Local submission statuses that carry a live remote dependency, and so freeze
 * what their removal represents: while one is present the removal's credit-batch
 * membership can't be regrouped and its facility's certifier mapping can't be
 * repointed/unlinked (ADR 0003). Terminal `rejected`/`superseded` rows are
 * excluded — they have no live remote resource a change could orphan.
 *
 * The single client-safe source for this list: the server guards in
 * `data-access/certification.ts` (`hasBlockingFacilitySubmission`,
 * `removalHasBlockingSubmission`) and the client gate in
 * `lib/certification/readiness.ts` (`canRegroupRemoval`) both import it from
 * here, so the UI never offers a control the server will refuse.
 */
export const BLOCKING_SUBMISSION_STATUSES: readonly LocalSubmissionStatus[] = [
  "draft",
  "submitted",
  "accepted",
];

/** Remote Isometric GHG-statement status (verifier lifecycle). */
export type RemoteGhgStatus = components["schemas"]["GhgStatementStatus"];

export type DerivedStatusKind =
  | "in-progress"
  | "interrupted"
  | "not-submitted"
  | "submitted"
  | "draft"
  | "in-registry"
  | "in-verification"
  | "verified"
  | "issued"
  | "rejected"
  | "verification-failed"
  | "superseded";

export interface DerivedStatus {
  /** Stable lifecycle discriminant; presentation code must not branch on label. */
  kind: DerivedStatusKind;
  /** Color value handed to `<StatusBadge status={value} />`. */
  value: StatusValue;
  /** Human-readable label. */
  label: string;
  /** Operator can still act (submit / resubmit) from this state. */
  isActionable: boolean;
  /** Nothing more is expected locally — a done-from-noma's-side state. */
  isTerminal: boolean;
}

const IN_PROGRESS: DerivedStatus = {
  kind: "in-progress",
  value: "running",
  label: "In progress",
  isActionable: false,
  isTerminal: false,
};

export interface RemovalStatusInput {
  /** Latest ledger status, or `null` when no submission row exists yet. */
  local: LocalSubmissionStatus | null;
  /** A draft row holding a live submission lock (derive from `lock.ts`). */
  lockInFlight: boolean;
  submissionInterrupted?: boolean;
}

export type RemovalEnrichmentStatus =
  | "loading"
  | "available"
  | "unavailable";

export type RemovalWorkflowStatusKind =
  | "checking"
  | "unavailable"
  | "ready"
  | "blocked"
  | "failed"
  | "interrupted"
  | "submitting"
  | "submitted"
  | "superseded";

export const REMOVAL_SUBMISSION_INTERRUPTED_OUTCOME = "interrupted" as const;
export const REMOVAL_SUBMISSION_INTERRUPTED_LABEL =
  "Submission interrupted";

export function isRemovalSubmissionInterrupted(metadata: unknown): boolean {
  return (
    getMetadataValue(
      metadata,
      SUBMISSION_METADATA_KEYS.lastAttemptOutcome,
    ) === REMOVAL_SUBMISSION_INTERRUPTED_OUTCOME
  );
}

export interface RemovalWorkflowStatus {
  /** The single operator-facing state used by list and detail surfaces. */
  kind: RemovalWorkflowStatusKind;
  value: StatusValue;
  label: string;
  /** Blocking reasons only; non-blocking notes live in their owning section. */
  reasons: string[];
  isActionable: boolean;
  canRetry: boolean;
}

function interruptedWorkflowStatus(
  reasons: string[],
  isActionable: boolean,
  canRetry: boolean,
): RemovalWorkflowStatus {
  return {
    kind: "interrupted",
    value: "failed",
    label: REMOVAL_SUBMISSION_INTERRUPTED_LABEL,
    reasons,
    isActionable,
    canRetry,
  };
}

export interface RemovalWorkflowStatusInput extends RemovalStatusInput {
  enrichmentStatus: RemovalEnrichmentStatus;
  readiness: RemovalReadiness | null;
}

/**
 * Operator-facing status for a Removal. Local-only — removals carry no remote
 * status, so the high end is "Submitted".
 */
export function deriveRemovalStatus({
  local,
  lockInFlight,
  submissionInterrupted = false,
}: RemovalStatusInput): DerivedStatus {
  if (local === "draft" && submissionInterrupted) {
    return {
      kind: "interrupted",
      value: "failed",
      label: REMOVAL_SUBMISSION_INTERRUPTED_LABEL,
      isActionable: !lockInFlight,
      isTerminal: false,
    };
  }
  if (lockInFlight) return IN_PROGRESS;
  if (local === null) {
    return {
      kind: "not-submitted",
      value: "draft",
      label: "Not submitted",
      isActionable: true,
      isTerminal: false,
    };
  }
  switch (local) {
    case "draft":
      // Stale-locked or rejected-cleared draft: actionable, treat as not sent.
      return {
        kind: "not-submitted",
        value: "draft",
        label: "Not submitted",
        isActionable: true,
        isTerminal: false,
      };
    case "submitted":
    // `accepted` is not reachable for removals (no remote source), but map it
    // defensively to the same done state rather than throwing.
    case "accepted":
      return {
        kind: "submitted",
        value: "issued",
        label: "Submitted",
        isActionable: false,
        isTerminal: true,
      };
    case "rejected":
      return {
        kind: "rejected",
        value: "rejected",
        label: "Rejected",
        isActionable: true,
        isTerminal: false,
      };
    case "superseded":
      // Callers pass the latest row. When superseding succeeds, a newer draft
      // or submitted row is therefore latest; a latest superseded row means a
      // stale attempt was retired before replacement (for example after the
      // fail-closed payload-freshness gate). The claim layer's
      // `after-superseded` path explicitly mints a fresh version on retry.
      return {
        kind: "not-submitted",
        value: "draft",
        label: "Not submitted",
        isActionable: true,
        isTerminal: false,
      };
  }
}

/**
 * Folds the persisted submission lifecycle and the readiness verdict into the
 * one state an operator needs. Callers should not present lifecycle and
 * readiness as separate, competing statuses.
 */
export function deriveRemovalWorkflowStatus({
  local,
  lockInFlight,
  enrichmentStatus,
  readiness,
  submissionInterrupted = false,
}: RemovalWorkflowStatusInput): RemovalWorkflowStatus {
  const lifecycle = deriveRemovalStatus({
    local,
    lockInFlight,
    submissionInterrupted,
  });

  if (lifecycle.kind === "submitted" || lifecycle.kind === "superseded") {
    return {
      kind: lifecycle.kind,
      value: lifecycle.value,
      label: lifecycle.label,
      reasons: [],
      isActionable: false,
      canRetry: false,
    };
  }

  if (lifecycle.kind === "interrupted") {
    if (lockInFlight) {
      return interruptedWorkflowStatus(
        [
          "This submission was interrupted. Wait, then select Review & submit when it becomes available.",
        ],
        false,
        false,
      );
    }
    if (enrichmentStatus === "loading") {
      return interruptedWorkflowStatus(
        ["Checking whether this submission is ready to reconcile."],
        false,
        false,
      );
    }
    if (enrichmentStatus === "unavailable" || !readiness) {
      return interruptedWorkflowStatus(
        ["Status checks could not finish. Select Retry to check again."],
        false,
        true,
      );
    }
    if (readiness.state === "blocked") {
      return interruptedWorkflowStatus(readiness.reasons, true, false);
    }
    if (readiness.state === "inProgress") {
      return interruptedWorkflowStatus(
        ["Waiting for the current submission check to finish."],
        false,
        false,
      );
    }
    return interruptedWorkflowStatus(
      [
        "This submission was interrupted and registry work may already exist. Select Review & submit to reconcile it.",
      ],
      true,
      false,
    );
  }

  if (lifecycle.kind === "in-progress") {
    return {
      kind: "submitting",
      value: "running",
      label: "Submitting",
      reasons: [],
      isActionable: false,
      canRetry: false,
    };
  }

  if (lifecycle.kind === "rejected") {
    const reasons =
      enrichmentStatus === "available" && readiness?.state === "blocked"
        ? readiness.reasons
        : ["Review submission history, then select Review & submit."];
    return {
      kind: "failed",
      value: "failed",
      label: "Submission failed",
      reasons,
      isActionable: true,
      canRetry: false,
    };
  }

  if (enrichmentStatus === "loading") {
    return {
      kind: "checking",
      value: "running",
      label: "Checking status",
      reasons: [],
      isActionable: false,
      canRetry: false,
    };
  }

  if (enrichmentStatus === "unavailable" || !readiness) {
    return {
      kind: "unavailable",
      value: "pending",
      label: "Status unavailable",
      reasons: [],
      isActionable: false,
      canRetry: true,
    };
  }

  switch (readiness.state) {
    case "ready":
      return {
        kind: "ready",
        value: "ready",
        label: "Ready to submit",
        reasons: [],
        isActionable: true,
        canRetry: false,
      };
    case "blocked":
      return {
        kind: "blocked",
        value: "pending",
        label: "Needs attention",
        reasons: readiness.reasons,
        isActionable: true,
        canRetry: false,
      };
    case "inProgress":
      return {
        kind: "submitting",
        value: "running",
        label: "Submitting",
        reasons: [],
        isActionable: false,
        canRetry: false,
      };
    case "submitted":
      return {
        kind: "submitted",
        value: "issued",
        label: "Submitted",
        reasons: [],
        isActionable: false,
        canRetry: false,
      };
  }
}

export interface StatementStatusInput {
  /** Latest ledger status, or `null` when no statement draft exists yet. */
  local: LocalSubmissionStatus | null;
  /** A draft row holding a live submission lock (derive from `lock.ts`). */
  lockInFlight: boolean;
  /** Persisted `metadata.remoteStatus`, or `null` before the first sync. */
  remoteStatus: RemoteGhgStatus | null;
}

/**
 * Operator-facing status for a GHG Statement. The verifier (remote) overlay
 * takes precedence once a non-DRAFT remote status is known; before that we
 * fall back to the shared local base.
 */
export function deriveStatementStatus({
  local,
  lockInFlight,
  remoteStatus,
}: StatementStatusInput): DerivedStatus {
  if (lockInFlight) return IN_PROGRESS;
  if (local === null) {
    return {
      kind: "draft",
      value: "draft",
      label: "Draft",
      isActionable: true,
      isTerminal: false,
    };
  }

  // Remote overlay — the verifier lifecycle, the part operators care about.
  switch (remoteStatus) {
    case "AWAITING_VERIFICATION":
      return {
        kind: "in-verification",
        value: "pending",
        label: "In verification",
        isActionable: false,
        isTerminal: false,
      };
    case "VERIFIED":
      return {
        kind: "verified",
        value: "verified",
        label: "Verified",
        isActionable: false,
        isTerminal: true,
      };
    case "CREDITS_ISSUED":
      return {
        kind: "issued",
        value: "issued",
        label: "Issued",
        isActionable: false,
        isTerminal: true,
      };
    case "FAILED_VERIFICATION":
      return {
        kind: "verification-failed",
        value: "rejected",
        label: "Verification failed",
        isActionable: true,
        isTerminal: false,
      };
    // "DRAFT" or null → fall through to the local base below.
    default:
      break;
  }

  switch (local) {
    case "draft":
      return {
        kind: "draft",
        value: "draft",
        label: "Draft",
        isActionable: true,
        isTerminal: false,
      };
    case "submitted":
      // Created in the registry, not yet sent to the verifier (remote DRAFT).
      // The next operator action is "Submit to verifier".
      return {
        kind: "in-registry",
        value: "running",
        label: "In registry",
        isActionable: false,
        isTerminal: false,
      };
    case "accepted":
      return {
        kind: "verified",
        value: "verified",
        label: "Verified",
        isActionable: false,
        isTerminal: true,
      };
    case "rejected":
      return {
        kind: "verification-failed",
        value: "rejected",
        label: "Verification failed",
        isActionable: true,
        isTerminal: false,
      };
    case "superseded":
      return {
        kind: "superseded",
        value: "superseded",
        label: "Superseded",
        isActionable: false,
        isTerminal: true,
      };
  }
}
