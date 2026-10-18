/**
 * Pure state behind the credit batch page (`/credit-batches/[id]`): its tabs,
 * the Overview badge, the four progress milestones and the one state-driven
 * header action. Components render these; nothing here fetches.
 */
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import type { DerivedStatusKind } from "@/lib/certification/status";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { CreditBatchOpenItem } from "./open-items";

export const CREDIT_BATCH_PAGE_TABS = ["overview", "production", "samples", "emissions", "removals", "activities"] as const;
export type CreditBatchPageTab = (typeof CREDIT_BATCH_PAGE_TABS)[number];

export const CREDIT_BATCH_PAGE_TAB_LABELS: Record<CreditBatchPageTab, string> = {
  overview: "Overview",
  production: "Production",
  samples: "Samples",
  emissions: "Emissions",
  removals: "Removals",
  activities: "Activities",
};

export interface CreditBatchOpenItemGroups {
  blocking: readonly CreditBatchOpenItem[];
  check: readonly CreditBatchOpenItem[];
  waiting: readonly CreditBatchOpenItem[];
}

/** The Overview tab badge: Blocking and Check items. Waiting items never count (Kenji, 2026-10-18). */
export function overviewBadgeCount(items: CreditBatchOpenItemGroups): number {
  return items.blocking.length + items.check.length;
}

export type CreditBatchMilestoneKey = "data" | "removal" | "verified" | "issued";
export type CreditBatchMilestoneState = "done" | "current" | "todo" | "failed";

export interface CreditBatchMilestone {
  key: CreditBatchMilestoneKey;
  label: string;
  state: CreditBatchMilestoneState;
  /** A record, a share or a date; null when the step has nothing to add. */
  caption: string | null;
  /** Blocking items holding the data step, shown as a red count. */
  count?: number;
}

const VERIFIED_KINDS: readonly DerivedStatusKind[] = ["verified", "issued"];

/** What a GHG Statement short of verification is doing, said on the Verified step. */
const STATEMENT_STEP_CAPTIONS: Partial<Record<DerivedStatusKind, string>> = {
  "in-verification": "In verification",
  "pending-changes": "Pending changes",
  "verification-failed": "Verification failed",
};

/** Under one gram of difference is the same mass at the page's precision. */
const SAME_MASS_TOLERANCE_KG = 0.001;

export interface CreditBatchMilestoneInput {
  /** Blocking open items; null while the batch health is loading or failed. */
  blockingCount: number | null;
  pageModel: CreditBatchPageModel | undefined;
}

function removalCaption(model: CreditBatchPageModel): string | null {
  const { firstRemovalSubmittedAt, firstRemovalSubmittedCode } = model.milestones;
  if (!firstRemovalSubmittedAt) {
    const draft = model.removals.find((removal) => removal.phase === "draft");
    return draft ? `${draft.code} in draft` : null;
  }
  const submitted = model.removals.filter((removal) => removal.phase === "submitted");
  const name = submitted.length > 1 ? `${submitted.length} Removals` : firstRemovalSubmittedCode;
  const { inSubmittedDryKg, appliedDryKg } = model.mass;
  // A partly sent batch says how much of its applied biochar the submitted Removals hold.
  if (appliedDryKg - inSubmittedDryKg > SAME_MASS_TOLERANCE_KG) {
    return `${name}, ${formatTonnes(kgToTonnes(inSubmittedDryKg))} of ${formatTonnes(kgToTonnes(appliedDryKg))}`;
  }
  return `${name}, ${formatDate(firstRemovalSubmittedAt)}`;
}

/**
 * The four milestones, each named for what has happened. The first reads
 * "Missing data" with the blocking count until no blocking item remains.
 * "Data complete" and "Verified" carry no date: none is stored.
 */
export function creditBatchMilestones({ blockingCount, pageModel }: CreditBatchMilestoneInput): CreditBatchMilestone[] {
  const statement = pageModel?.milestones.ghgStatement ?? null;
  const missing = blockingCount != null && blockingCount > 0;
  const steps: { key: CreditBatchMilestoneKey; label: string; done: boolean; failed?: boolean; caption: string | null; count?: number }[] = [
    {
      key: "data",
      label: missing ? "Missing data" : "Data complete",
      done: blockingCount === 0,
      caption: null,
      count: missing ? blockingCount : undefined,
    },
    {
      key: "removal",
      label: "Removal submitted",
      done: !!pageModel?.milestones.firstRemovalSubmittedAt,
      caption: pageModel ? removalCaption(pageModel) : null,
    },
    {
      key: "verified",
      label: "Verified",
      done: !!statement && VERIFIED_KINDS.includes(statement.status),
      failed: statement?.status === "verification-failed",
      caption: statement ? STATEMENT_STEP_CAPTIONS[statement.status] ?? null : null,
    },
    {
      key: "issued",
      label: "Credits issued",
      done: statement?.status === "issued",
      caption: statement?.status === "issued" && statement.creditsIssuedAt ? formatDate(statement.creditsIssuedAt) : null,
    },
  ];
  const currentIndex = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({
    key: step.key,
    label: step.label,
    state: step.done ? "done" : step.failed ? "failed" : index === currentIndex ? "current" : "todo",
    // Later steps say nothing until the batch reaches them.
    caption: step.done || index === currentIndex ? step.caption : null,
    ...(step.count != null ? { count: step.count } : {}),
  }));
}

export type CreditBatchPrimaryAction =
  | { kind: "fix"; label: string; item: CreditBatchOpenItem }
  | { kind: "draft"; label: string; removalId: string }
  | { kind: "start"; label: string };

export const FIX_NEXT_ITEM_LABEL = "Fix next item";
export const START_REMOVAL_LABEL = "Start Removal";

export interface CreditBatchPrimaryActionInput {
  /** Blocking open items; undefined while the batch health is loading. */
  blocking: readonly CreditBatchOpenItem[] | undefined;
  pageModel: CreditBatchPageModel | undefined;
  lock: RecordLockView | undefined;
}

/**
 * The header's one state-driven button: Fix next item, then Open the draft
 * Removal, then Start Removal. None once a Removal or the batch is submitted
 * (Kenji), none while the inputs load, none when nothing is applied.
 */
export function creditBatchPrimaryAction({ blocking, pageModel, lock }: CreditBatchPrimaryActionInput): CreditBatchPrimaryAction | null {
  if (!blocking || !pageModel) return null;
  if (lock?.level === "sent") return null;
  if (pageModel.removals.some((removal) => removal.phase === "submitted")) return null;
  if (blocking.length > 0) return { kind: "fix", label: FIX_NEXT_ITEM_LABEL, item: blocking[0] };
  const draft = pageModel.removals.find((removal) => removal.phase === "draft");
  if (draft) return { kind: "draft", label: `Open ${draft.code}`, removalId: draft.id };
  if (pageModel.mass.notInRemovalDryKg > 0) return { kind: "start", label: START_REMOVAL_LABEL };
  return null;
}
