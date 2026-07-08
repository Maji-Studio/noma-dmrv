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
 *     ends at "Submitted" (+ "Superseded" on a re-version). Verified in code:
 *     `submit-removal.ts` only ever marks the ledger row `submitted`.
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

export interface DerivedStatus {
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
}

/**
 * Operator-facing status for a Removal. Local-only — removals carry no remote
 * status, so the high end is "Submitted" / "Superseded".
 */
export function deriveRemovalStatus({
  local,
  lockInFlight,
}: RemovalStatusInput): DerivedStatus {
  if (lockInFlight) return IN_PROGRESS;
  if (local === null) {
    return {
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
        value: "issued",
        label: "Submitted",
        isActionable: false,
        isTerminal: true,
      };
    case "rejected":
      return {
        value: "rejected",
        label: "Rejected",
        isActionable: true,
        isTerminal: false,
      };
    case "superseded":
      return {
        value: "superseded",
        label: "Superseded",
        isActionable: false,
        isTerminal: true,
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
        value: "pending",
        label: "In verification",
        isActionable: false,
        isTerminal: false,
      };
    case "VERIFIED":
      return {
        value: "verified",
        label: "Verified",
        isActionable: false,
        isTerminal: true,
      };
    case "CREDITS_ISSUED":
      return {
        value: "issued",
        label: "Issued",
        isActionable: false,
        isTerminal: true,
      };
    case "FAILED_VERIFICATION":
      return {
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
        value: "draft",
        label: "Draft",
        isActionable: true,
        isTerminal: false,
      };
    case "submitted":
      // Created in the registry, not yet sent to the verifier (remote DRAFT).
      // The next operator action is "Submit to verifier".
      return {
        value: "running",
        label: "In registry",
        isActionable: false,
        isTerminal: false,
      };
    case "accepted":
      return {
        value: "verified",
        label: "Verified",
        isActionable: false,
        isTerminal: true,
      };
    case "rejected":
      return {
        value: "rejected",
        label: "Verification failed",
        isActionable: true,
        isTerminal: false,
      };
    case "superseded":
      return {
        value: "superseded",
        label: "Superseded",
        isActionable: false,
        isTerminal: true,
      };
  }
}
