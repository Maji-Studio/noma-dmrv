/**
 * What the dashboard's "Needs attention" list says about a Removal (#1554).
 * One row per Removal that needs the operator, in the words of the Removals
 * list: a draft reads "N to fix" or "Ready to submit"; a rejected one reads
 * "Not submitted"; a submitted Removal has no row. Pure, so the list and its
 * tests share one source.
 */
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import type { RemovalReadiness } from "@/lib/certification/readiness";
import { recordHref } from "@/lib/record-links";

export const REMOVAL_INTERRUPTED_ATTENTION_TITLE = "Submission interrupted";
export const REMOVAL_REJECTED_ATTENTION_TITLE = "Not submitted";

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
export type RejectedRemoval = RemovalAttentionBase & { readiness?: undefined };

export function draftRemovalAttentionItems(
  drafts: readonly (DraftRemovalReadiness | RejectedRemoval)[],
  facilityId: string,
): DashboardAttentionItem[] {
  return drafts.flatMap((draft) => {
    const title = draft.readiness ? draftRemovalAttentionTitle(draft.readiness) : REMOVAL_REJECTED_ATTENTION_TITLE;
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
