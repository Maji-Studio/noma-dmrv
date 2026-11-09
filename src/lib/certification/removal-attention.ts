/**
 * What the dashboard's "Needs attention" list says about a Removal (#1554).
 * One row per Removal that needs the operator, in the label form of the other
 * rows: a draft reads "N to fix" or "Ready to submit"; a rejected one reads as
 * the Removals list calls it ("Submission failed"); a returned one reads
 * "Correction needed" or "Resubmit needed"; a submitted Removal has no row.
 * Pure, so the list and its tests share one source. The data-access aggregate
 * (`getDashboardOverview`) takes these rows and owns ordering, caps and totals.
 */
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import type { RemovalReadiness } from "@/lib/certification/readiness";
import { REMOVAL_SUBMISSION_FAILED } from "@/lib/certification/status";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import { RETURNED_BY_ISOMETRIC_LABEL } from "@/lib/certification/emission-entry-messages";
import { correctionStatus } from "@/lib/removal-correction-copy";
import { recordHref } from "@/lib/record-links";

export const REMOVAL_INTERRUPTED_ATTENTION_TITLE = "Submission interrupted";
export const REMOVAL_REJECTED_ATTENTION_TITLE = REMOVAL_SUBMISSION_FAILED.label;

/** A draft's title, or null when it needs nothing from the operator right now (a submission is running). */
export function draftRemovalAttentionTitle(readiness: Pick<RemovalReadiness, "state" | "reasons" | "fixCount">): string | null {
  if (readiness.state === "ready") return "Ready to submit";
  if (readiness.state === "blocked") return `${readiness.fixCount ?? readiness.reasons.length} to fix`;
  return null;
}

interface RemovalAttentionBase {
  removalId: string;
  code: string;
  createdAt: Date;
}

export type DraftRemovalReadiness = RemovalAttentionBase & {
  readiness: Pick<RemovalReadiness, "state" | "reasons" | "fixCount">;
};

/** A Removal whose last submission was rejected: it stays with the operator. */
export type RejectedRemoval = RemovalAttentionBase;

/** A submitted Removal whose GHG Statement the verifier returned; `correction` is set while its window is open. */
export type ReturnedRemoval = RemovalAttentionBase & { correction: RemovalCorrection | undefined };

export interface RemovalAttentionSources {
  drafts: readonly DraftRemovalReadiness[];
  rejected: readonly RejectedRemoval[];
  returned: readonly ReturnedRemoval[];
}

export interface RemovalAttentionRows {
  drafts: DashboardAttentionItem[];
  rejected: DashboardAttentionItem[];
  /** Keyed by Removal id, so the aggregate can drop the per-credit-batch rows these replace. */
  returned: { removalId: string; item: DashboardAttentionItem }[];
}

export const NO_REMOVAL_ATTENTION: RemovalAttentionRows = { drafts: [], rejected: [], returned: [] };

function rowFor(removal: RemovalAttentionBase, title: string, facilityId: string): DashboardAttentionItem {
  return {
    id: `removal-draft-${removal.removalId}`,
    entityCode: removal.code,
    date: removal.createdAt,
    title,
    href: recordHref("removal", removal.removalId, { facilityId }),
  };
}

export function removalAttentionRows(sources: RemovalAttentionSources, facilityId: string): RemovalAttentionRows {
  return {
    drafts: sources.drafts.flatMap((draft) => {
      const title = draftRemovalAttentionTitle(draft.readiness);
      return title ? [rowFor(draft, title, facilityId)] : [];
    }),
    rejected: sources.rejected.map((removal) => rowFor(removal, REMOVAL_REJECTED_ATTENTION_TITLE, facilityId)),
    returned: sources.returned.map((removal) => ({
      removalId: removal.removalId,
      item: {
        ...rowFor(removal, removal.correction ? correctionStatus(removal.correction).label : RETURNED_BY_ISOMETRIC_LABEL, facilityId),
        id: `removal-returned-${removal.removalId}`,
      },
    })),
  };
}
