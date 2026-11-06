/**
 * What the dashboard's "Needs attention" list says about a Removal (#1554).
 * One row per Removal that needs the operator, in the words of the Removals
 * list: a draft reads "N to fix." or "Ready to submit."; a submitted Removal
 * has no row. Pure, so the list and its tests share one source.
 */
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import type { RemovalReadiness } from "@/lib/certification/readiness";
import { recordHref } from "@/lib/record-links";

export const REMOVAL_INTERRUPTED_ATTENTION_TITLE = "Submission interrupted. Review and submit again to finish it.";

/** A draft's title, or null when it needs nothing from the operator right now (a submission is running). */
export function draftRemovalAttentionTitle(readiness: Pick<RemovalReadiness, "state" | "reasons">): string | null {
  if (readiness.state === "ready") return "Ready to submit.";
  if (readiness.state === "blocked") return `${readiness.reasons.length} to fix.`;
  return null;
}

export interface DraftRemovalReadiness {
  removalId: string;
  code: string;
  createdAt: Date;
  readiness: Pick<RemovalReadiness, "state" | "reasons">;
}

export function draftRemovalAttentionItems(drafts: readonly DraftRemovalReadiness[], facilityId: string): DashboardAttentionItem[] {
  return drafts.flatMap((draft) => {
    const title = draftRemovalAttentionTitle(draft.readiness);
    if (!title) return [];
    return [{
      id: `removal-draft-${draft.removalId}`,
      entityCode: draft.code,
      date: draft.createdAt,
      title,
      href: recordHref("removal", draft.removalId, { facilityId }),
    }];
  });
}
