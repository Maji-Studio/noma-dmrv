/**
 * The one place a Removal's shown status is assembled (#1636). It folds the
 * workflow status (`deriveRemovalWorkflowStatus`) and the correction overlay
 * (a returned Removal with its window open, or a returning record lock) into
 * the state, the badge per surface and the next step line. Surfaces read their
 * own output and never overlay a correction themselves. Pure.
 *
 * The dashboard's attention rows read a narrow projection (readiness, or the
 * correction) by design, not a full workflow input, so they go through
 * `removalAttentionTitle`, which shares this module's wording and correction
 * badge.
 */
import type { StatusValue } from "@/components/ui/status-badge";
import { RETURNED_BY_ISOMETRIC_LABEL } from "@/lib/certification/emission-entry-messages";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import type { RemovalReadiness } from "@/lib/certification/readiness";
import {
  deriveRemovalWorkflowStatus,
  REMOVAL_SUBMISSION_FAILED,
  type RemovalWorkflowStatus,
  type RemovalWorkflowStatusInput,
} from "@/lib/certification/status";
import { CORRECTION_NEEDED_STATUS_LABEL, RESUBMIT_NEEDED_LABEL } from "@/lib/removal-correction-copy";

export interface ShownBadge {
  value: StatusValue;
  label: string;
}

export interface RemovalShownStatusInput {
  workflow: RemovalWorkflowStatusInput;
  /** Set while a returned Removal's correction window is open. */
  correction?: RemovalCorrection;
  /** A record lock names Isometric returning this Removal (the lock-based return of #1134). */
  returnedByLock?: boolean;
}

export interface RemovalShownStatus {
  /** The Removal's own workflow status, before any overlay. */
  workflow: RemovalWorkflowStatus;
  /** The badge on a Removals list cell. */
  list: ShownBadge;
  /** The badge in the Removal sheet header. */
  sheet: ShownBadge;
  /** What the list's status column search matches. */
  searchText: string;
  /** A correction replaces the lock-based cell under the list badge. */
  showLockCell: boolean;
  /** The one next step for states no notice speaks for, or null. */
  nextStep: string | null;
}

export const REMOVAL_READINESS_UNAVAILABLE_TITLE = "Couldn't check. Open it to see what is left.";
export const REMOVAL_REJECTED_ATTENTION_TITLE = REMOVAL_SUBMISSION_FAILED.label;

const CORRECTION_BADGE_VALUE = "pending" satisfies StatusValue;

/**
 * What a list cell calls a Removal's status. A draft that is blocked reads
 * "N to fix", the fixes Review & submit lists for its unmet checks (not the reason count); the reasons themselves live
 * on the sheet and in Review & submit. Every other state keeps its own label.
 */
export function listStatusLabel(status: { kind: string; label: string; reasons: readonly string[]; fixCount?: number }): string {
  const count = fixCountOf(status);
  return status.kind === "blocked" && count > 0 ? toFixLabel(count) : status.label;
}

function fixCountOf(status: { reasons: readonly string[]; fixCount?: number }): number {
  return status.fixCount ?? status.reasons.length;
}

function toFixLabel(count: number): string {
  return `${count} to fix`;
}

/** The badge a returned Removal shows in place of its own status. */
function correctionBadge(correction: RemovalCorrection): ShownBadge {
  return { value: CORRECTION_BADGE_VALUE, label: correction.resubmitNeeded ? RESUBMIT_NEEDED_LABEL : CORRECTION_NEEDED_STATUS_LABEL };
}

/** A draft reads "Not submitted" on the sheet whether or not it can be sent yet (#1554); otherwise the correction, else the workflow's own badge. */
function sheetBadge(workflow: RemovalWorkflowStatus, correction: ShownBadge | null): ShownBadge {
  if (workflow.kind === "blocked" || workflow.kind === "ready") return { value: "draft", label: "Not submitted" };
  return correction ?? { value: workflow.value, label: workflow.label };
}

function nextStepFor(workflow: RemovalWorkflowStatus): string | null {
  switch (workflow.kind) {
    // "checking": the header badge already says so.
    case "unavailable":
      return "The checks could not load.";
    case "submitting":
      return "noma is sending this Removal to Isometric. This can take a few minutes.";
    case "submitted":
      return "Isometric verifies it with the GHG Statement for its reporting period.";
    default:
      return null;
  }
}

export function deriveRemovalShownStatus(input: RemovalShownStatusInput): RemovalShownStatus {
  const workflow = deriveRemovalWorkflowStatus(input.workflow);
  const badge = input.correction ? correctionBadge(input.correction) : null;
  const returned = !!badge || !!input.returnedByLock;
  const ownLabel = listStatusLabel(workflow);
  const returnedSuffix = badge ? ` ${badge.label}` : input.returnedByLock ? ` ${CORRECTION_NEEDED_STATUS_LABEL}` : "";
  return {
    workflow,
    list: badge ?? { value: workflow.value, label: ownLabel },
    sheet: sheetBadge(workflow, badge),
    searchText: `${ownLabel}${returnedSuffix}`,
    showLockCell: !badge,
    // A returned Removal has its own notice; "Isometric verifies it" would contradict it.
    nextStep: returned ? null : nextStepFor(workflow),
  };
}

/** What the dashboard's "Needs attention" list says about a Removal. Null: nothing needs the operator (a submission is running). */
export type RemovalAttentionSource =
  | { kind: "draft"; /** Null means readiness failed to load. */ readiness: Pick<RemovalReadiness, "state" | "reasons" | "fixCount"> | null }
  | { kind: "rejected" }
  | { kind: "returned"; correction: RemovalCorrection | undefined };

export function removalAttentionTitle(source: RemovalAttentionSource): string | null {
  switch (source.kind) {
    case "rejected":
      return REMOVAL_REJECTED_ATTENTION_TITLE;
    case "returned":
      return source.correction ? correctionBadge(source.correction).label : RETURNED_BY_ISOMETRIC_LABEL;
    case "draft": {
      const { readiness } = source;
      if (readiness === null) return REMOVAL_READINESS_UNAVAILABLE_TITLE;
      if (readiness.state === "ready") return "Ready to submit";
      // Unlike the list cell, a blocked draft always reads its count here, even 0.
      if (readiness.state === "blocked") return toFixLabel(fixCountOf(readiness));
      return null;
    }
  }
}
