/**
 * The one place a Removal's shown status is assembled (#1636). It folds the
 * workflow status (`deriveRemovalWorkflowStatus`) and the correction overlay
 * (a returned Removal with its window open, or a returning record lock) into
 * the state, the badge per surface and the next step line. Surfaces read their
 * own output and never overlay a correction themselves. Pure.
 */
import type { StatusValue } from "@/components/ui/status-badge";
import { RETURNED_BY_ISOMETRIC_LABEL } from "@/lib/certification/emission-entry-messages";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import {
  deriveRemovalWorkflowStatus,
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
  overlay: "none" | "correction-needed" | "resubmit-needed";
  /** Isometric returned the Removal, by correction or by lock: a returned notice speaks for it. */
  returned: boolean;
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

const CORRECTION_BADGE_VALUE = "pending" satisfies StatusValue;

/**
 * What a list cell calls a Removal's status. A draft that is blocked reads
 * "N to fix", the fixes Review & submit lists for its unmet checks (not the reason count); the reasons themselves live
 * on the sheet and in Review & submit. Every other state keeps its own label.
 */
export function listStatusLabel(status: { kind: string; label: string; reasons: readonly string[]; fixCount?: number }): string {
  const count = status.fixCount ?? status.reasons.length;
  return status.kind === "blocked" && count > 0 ? `${count} to fix` : status.label;
}

/** The badge a returned Removal shows in place of its own status. */
function correctionBadge(correction: RemovalCorrection): ShownBadge {
  return { value: CORRECTION_BADGE_VALUE, label: correction.resubmitNeeded ? RESUBMIT_NEEDED_LABEL : CORRECTION_NEEDED_STATUS_LABEL };
}

/** A draft reads "Not submitted" on the sheet whether or not it can be sent yet (#1554). */
function sheetBadge(workflow: RemovalWorkflowStatus): ShownBadge {
  if (workflow.kind === "blocked" || workflow.kind === "ready") return { value: "draft", label: "Not submitted" };
  return { value: workflow.value, label: workflow.label };
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
  const { correction } = input;
  const returned = !!correction || !!input.returnedByLock;
  const ownList: ShownBadge = { value: workflow.value, label: listStatusLabel(workflow) };
  const overlay = correction ? correctionBadge(correction) : null;
  const lockSuffix = !correction && input.returnedByLock ? ` ${CORRECTION_NEEDED_STATUS_LABEL}` : "";
  return {
    workflow,
    overlay: !correction ? "none" : correction.resubmitNeeded ? "resubmit-needed" : "correction-needed",
    returned,
    list: overlay ?? ownList,
    // The sheet overlays value and label but keeps the workflow's "Not submitted" rule keyed on its own kind.
    sheet: workflow.kind === "blocked" || workflow.kind === "ready" ? sheetBadge(workflow) : (overlay ?? sheetBadge(workflow)),
    searchText: `${ownList.label}${correction ? ` ${correctionBadge(correction).label}` : lockSuffix}`,
    showLockCell: !correction,
    // A returned Removal has its own notice; "Isometric verifies it" would contradict it.
    nextStep: returned ? null : nextStepFor(workflow),
  };
}

/** What a dashboard attention row calls a Removal Isometric returned: the correction state while its window is open, else the plain return. */
export function returnedRemovalAttentionLabel(correction: RemovalCorrection | undefined): string {
  return correction ? correctionBadge(correction).label : RETURNED_BY_ISOMETRIC_LABEL;
}
