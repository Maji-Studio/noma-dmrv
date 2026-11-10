/**
 * What the dashboard's "Needs attention" list says about a Removal (#1554).
 * One row per Removal that needs the operator, in the label form of the other
 * rows: a draft reads "N to fix", "Ready to submit" or "Couldn't check";
 * a rejected one reads as the Removals list calls it ("Submission failed");
 * a returned one reads
 * "Correction needed" or "Resubmit needed"; a submitted Removal has no row.
 * Pure, so the list and its tests share one source. The data-access aggregate
 * (`getDashboardOverview`) takes these rows and owns ordering, caps and totals.
 */
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import type { RemovalReadiness } from "@/lib/certification/readiness";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import { removalAttentionTitle, REMOVAL_REJECTED_ATTENTION_TITLE } from "@/lib/certification/removal-shown-status";
import { recordHref } from "@/lib/record-links";

export { REMOVAL_REJECTED_ATTENTION_TITLE };

export const REMOVAL_INTERRUPTED_ATTENTION_TITLE = "Submission interrupted";

interface RemovalAttentionBase {
  removalId: string;
  code: string;
  createdAt: Date;
}

export type DraftRemovalReadiness = RemovalAttentionBase & {
  /** Null means readiness failed to load; the draft still needs an operator row. */
  readiness: Pick<RemovalReadiness, "state" | "reasons" | "fixCount"> | null;
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
  /** Removals a draft or rejected row stands for, so the aggregate drops the credit batch "not submitted" rows they replace. */
  covered: ReadonlySet<string>;
}

export const NO_REMOVAL_ATTENTION: RemovalAttentionRows = { drafts: [], rejected: [], returned: [], covered: new Set() };

function rowFor(removal: RemovalAttentionBase, title: string, facilityId: string): DashboardAttentionItem {
  return {
    id: `removal-draft-${removal.removalId}`,
    recordIds: [removal.removalId],
    entityCode: removal.code,
    date: removal.createdAt,
    title,
    href: recordHref("removal", removal.removalId, { facilityId }),
  };
}

export function removalAttentionRows(sources: RemovalAttentionSources, facilityId: string): RemovalAttentionRows {
  const drafts = sources.drafts.flatMap((draft) => {
    const title = removalAttentionTitle({ kind: "draft", readiness: draft.readiness });
    return title === null ? [] : [{ draft, title }];
  });
  return {
    drafts: drafts.map(({ draft, title }) => rowFor(draft, title, facilityId)),
    rejected: sources.rejected.map((removal) => rowFor(removal, removalAttentionTitle({ kind: "rejected" }), facilityId)),
    covered: new Set([...drafts.map(({ draft }) => draft), ...sources.rejected].map((removal) => removal.removalId)),
    returned: sources.returned.map((removal) => ({
      removalId: removal.removalId,
      item: {
        ...rowFor(removal, removalAttentionTitle({ kind: "returned", correction: removal.correction }), facilityId),
        id: `removal-returned-${removal.removalId}`,
      },
    })),
  };
}
