/**
 * The fix list of Review & submit: one short title per thing the operator must
 * fix, the full message behind an (i), and the links that repair it.
 *
 * Three sources feed it and none is special-cased by code:
 *   - unmet readiness checks (title: `certCheckLabel`, links: `fixLinksFor`),
 *   - blocked component rows of the component table (title: the component),
 *   - compile blockers (title: the line's name, else a title for the fix
 *     target, else the message itself).
 * A blocker therefore needs nothing added here when a new kind appears: its
 * message and `fixTarget` are enough.
 */
import type { BatchHealthFixTarget } from "@/lib/certification/batch-health";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import { certCheckLabel } from "@/lib/certification/requirement-labels";
import { removalLineBlockerMessage, type RemovalBlocker } from "@/lib/certification/removal-blockers";
import { removalFindingFixLink } from "@/lib/certification/removal-finding-links";
import { dateGuidance, fixLinksFor, type CheckCreditBatch } from "./check-fix-links";
import type { ComponentRow } from "./component-table-model";
import { actionableSubmissionChecks } from "./submission-facts";

/** Readiness details pack several records into one string. */
const DETAIL_SEPARATOR = " · ";

export interface ReviewFix {
  label: string;
  href: string;
}

export interface ReviewItem {
  /** Stable while the item stays open, so a fixed item keeps its place in the list. */
  id: string;
  title: string;
  /** One sentence behind the (i): why it matters, or the full message. */
  explanation: string | null;
  /** More lines behind the (i): the records involved. */
  lines: string[];
  /** The credit batch it is about, when the title does not name it. */
  batchCode: string | null;
  fixes: ReviewFix[];
}

/** What a repair destination is called when the finding itself names no line. */
const TITLE_BY_FIX_TARGET: Partial<Record<BatchHealthFixTarget, string>> = {
  emissions: "Emissions entry",
  certificationEmissions: "Facility emissions",
  certificationTemplates: "Removal template",
  templateSetup: "Removal template",
  templateReplacement: "Removal template",
  templateLines: "Template components",
  templateLineReview: "Template components",
  batchDetails: "Credit batch details",
  orders: "Orders",
  deliveries: "Deliveries",
  deliveryEvidence: "Delivery evidence",
  deliveryDistances: "Delivery distances",
  feedstocks: "Feedstock deliveries",
  feedstockTypes: "Feedstock types",
  productionRuns: "Production runs",
  biocharProducts: "Biochar products",
  labSamples: "Samples",
  applications: "Applications",
  sourceData: "Source data",
};

/** A line name a person would recognise: some blockers carry the component id in its place. */
function lineName(blocker: RemovalBlocker): string | null {
  const ref = blocker.lineRef;
  const name = ref?.displayName.trim();
  if (!ref || !name || name === ref.componentId || name.includes("_") || name.includes("/")) return null;
  return name;
}

function blockerTitle(blocker: RemovalBlocker): string {
  return lineName(blocker) ?? (blocker.fixTarget ? TITLE_BY_FIX_TARGET[blocker.fixTarget] : undefined) ?? blocker.message;
}

export function checkItems(
  checks: readonly RemovalRequirementCheck[],
  facilityId: string,
  creditBatches: readonly CheckCreditBatch[],
): ReviewItem[] {
  return actionableSubmissionChecks([...checks])
    .filter((check) => check.status === "unmet")
    .map((check) => {
      const lines = check.detail?.split(DETAIL_SEPARATOR) ?? [];
      return {
        id: `check:${check.key}:${check.transportCategory ?? ""}`,
        title: certCheckLabel(check),
        explanation: check.whyDetail ?? null,
        lines: check.key === "measurementDates" && lines.length > 0 ? [...lines, dateGuidance(lines.length)] : lines,
        batchCode: null,
        fixes: fixLinksFor(check, facilityId, creditBatches),
      };
    });
}

/** One item per blocked component, with every distinct message and repair its row carries. */
export function componentItems(rows: readonly ComponentRow[]): ReviewItem[] {
  return rows.flatMap((row) => {
    if (!row.blocked) return [];
    const items = row.blocked.items;
    const fixes = new Map<string, ReviewFix>();
    for (const item of items) {
      for (const fix of item.fixes) {
        fixes.set(fix.href, { href: fix.href, label: fix.batchCode ? `${fix.label} on ${fix.batchCode}` : fix.label });
      }
    }
    const batchCodes = [...new Set(items.flatMap((item) => item.batchCodes))];
    return [{
      id: `component:${row.componentId}`,
      title: row.name,
      explanation: items.length === 1 ? items[0].message : null,
      lines: items.length === 1 ? [] : items.map((item) => item.message),
      batchCode: batchCodes.length > 0 ? batchCodes.join(", ") : null,
      fixes: [...fixes.values()],
    }];
  });
}

/**
 * Compile blockers a blocked component row does not already say. The row
 * carries the same sentence and its repair, so repeating it would count one
 * fix twice.
 */
export function blockersOutsideRows(
  blockers: readonly RemovalBlocker[],
  rows: readonly ComponentRow[],
  unbindable: { text: string | null; componentIds: readonly string[] },
): RemovalBlocker[] {
  const shown = new Map(rows.map((row) => [row.componentId, new Set(row.blocked?.items.map((item) => item.message))]));
  const unbindableNamed = unbindable.componentIds.length > 0 && unbindable.componentIds.every((id) => shown.has(id));
  return blockers.filter((blocker) => {
    if (blocker.lineRef && shown.get(blocker.lineRef.componentId)?.has(blocker.message)) return false;
    return !(unbindableNamed && unbindable.text !== null && blocker.message === unbindable.text);
  });
}

export function blockerItems(
  blockers: readonly RemovalBlocker[],
  facilityId: string,
  memberBatchIds: readonly string[],
): ReviewItem[] {
  const occurrences = new Map<string, number>();
  return blockers.map((blocker) => {
    const title = blockerTitle(blocker);
    const message = removalLineBlockerMessage(blocker);
    const fix = removalFindingFixLink(blocker, facilityId, memberBatchIds);
    return {
      id: blockerId(blocker, occurrences),
      title,
      // A title that is the message already says everything.
      explanation: title === blocker.message ? null : message,
      lines: [],
      batchCode: null,
      fixes: fix ? [fix] : [],
    };
  });
}

/**
 * Stable while one fault is partly fixed, distinct for distinct faults. The key is the code, the line and
 * the repair; blockers sharing it (two entries on different batches, two compiler messages) are told apart by
 * their message with only standalone counts left out (so "3 entries" turning into "2 entries" keeps its id, while
 * the dates and batch codes that identify a fault stay in the key), and a blocker repeating even that gets its
 * occurrence number (identical messages, so a shift between them shows nothing different).
 */
/** A count on its own: not part of a date, a code or a word. */
const STANDALONE_COUNT = /(?<![\w-])\d+(?![\w-])/g;

function blockerId(blocker: RemovalBlocker, occurrences: Map<string, number>): string {
  const base = `blocker:${blocker.code}:${blocker.lineRef?.componentId ?? ""}:${blocker.fixTarget ?? ""}:${blocker.message.replace(STANDALONE_COUNT, "#")}`;
  const nth = occurrences.get(base) ?? 0;
  occurrences.set(base, nth + 1);
  return nth === 0 ? base : `${base}:${nth}`;
}

export interface ReviewItemsInput {
  checks: readonly RemovalRequirementCheck[];
  blockers: readonly RemovalBlocker[];
  blockedRows: readonly ComponentRow[];
  creditBatches: readonly CheckCreditBatch[];
  facilityId: string;
  unbindableText: string | null;
  unbindableComponentIds: readonly string[];
}

/** Everything the operator has to fix, in the order they would work through it. */
export function buildReviewItems(input: ReviewItemsInput): ReviewItem[] {
  const memberBatchIds = input.creditBatches.map((batch) => batch.id);
  const others = blockersOutsideRows(input.blockers, input.blockedRows, {
    text: input.unbindableText,
    componentIds: input.unbindableComponentIds,
  });
  return [
    ...checkItems(input.checks, input.facilityId, input.creditBatches),
    ...componentItems(input.blockedRows),
    ...blockerItems(others, input.facilityId, memberBatchIds),
  ];
}
