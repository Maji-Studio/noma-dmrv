/**
 * The words of the Production Run footer's credit batch line (#1164), one
 * entry per preview state. Pure, so every state's copy is tested without a
 * server. Membership itself is decided on the server; this only phrases it.
 */
import { formatDateRange, formatDayString } from "@/lib/format-utils";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  CREDIT_BATCH_LEAD,
  CREDIT_BATCH_LINE_BASE,
  errorLineCopy,
  pendingLineCopy,
  type CreditBatchLineCopy,
} from "@/components/credit-batches/credit-batch-line-copy";
import type {
  CreditBatchPreviewBatch,
  ProductionRunCreditBatchPreview,
  ProductionRunCreditBatchPreviewBasis,
} from "@/types/production-run-credit-batch-preview";

/** The line while a check runs or after it failed, on top of the server states. */
export type ProductionRunCreditBatchPreviewView =
  | { state: "pending" }
  | { state: "error" }
  | ProductionRunCreditBatchPreview;

const INCOMPLETE_LEAD = {
  facility: "Choose a facility in the sidebar to see the credit batch.",
  start: "Enter the start date and time to see the credit batch.",
  end: "Enter the end date and time to see the credit batch.",
  feedstock: "Choose a source bin to see the credit batch.",
} as const;

const END_DAY_RULE =
  "A completed run joins the credit batch that covers its end day at the facility, for its feedstock.";

function zoneName(timeZone: string): string {
  return timeZone.replace(/_/g, " ");
}

/** "Matched on the end day, Oct 2, 2026 (Africa/Dar es Salaam), at Mafinga Facility with Forestry waste." */
function matchedOn(basis: ProductionRunCreditBatchPreviewBasis): string {
  const day = `${formatDayString(basis.day)} (${zoneName(basis.timeZone)})`;
  const what = basis.dayBasis === "end" ? "the end day" : "the start day";
  return `Matched on ${what}, ${day}, at ${basis.facilityName} with ${basis.feedstockTypeName}.`;
}

/** Why a start day stands in, said every time it does. */
const START_DAY_STANDS_IN =
  "This run has no end time yet, so its start day stands in. Once it is completed, it joins the batch that covers its end day, which can be another one.";

/** The window as its own field, so a phone can hide it (#1059). */
function windowLabel(batch: CreditBatchPreviewBatch): string {
  return ` (${formatDateRange(batch.startDate, batch.endDate)})`;
}

/**
 * The one visible start-day qualifier, a trailing clause: ", by start day"
 * when the start day stood in, "" when the end day decided. The ⓘ explains
 * it through `provisional`.
 */
function byStartDay(basis: ProductionRunCreditBatchPreviewBasis): string {
  return basis.dayBasis === "start" ? ", by start day" : "";
}

/** Leads with the stand-in caveat whenever the start day decided the answer. */
function provisional(basis: ProductionRunCreditBatchPreviewBasis, text: string): string {
  return basis.dayBasis === "start" ? `${START_DAY_STANDS_IN} ${text}` : text;
}

function joinInfo(basis: ProductionRunCreditBatchPreviewBasis, expected: boolean): string {
  if (basis.dayBasis === "start") return `${START_DAY_STANDS_IN} ${matchedOn(basis)}`;
  if (expected) return `A running run joins when it is completed, by its end day. ${matchedOn(basis)}`;
  return `${matchedOn(basis)} The whole run joins this batch.`;
}

function memberCopy(
  preview: Extract<ProductionRunCreditBatchPreview, { state: "member" }>,
): CreditBatchLineCopy {
  const { batch, basis, conflict } = preview;
  const base = { ...CREDIT_BATCH_LINE_BASE, lead: CREDIT_BATCH_LEAD, batches: [batch] };
  switch (conflict) {
    case null:
      return { ...base, window: windowLabel(batch), info: basis ? matchedOn(basis) : null };
    case "outside-window":
      return {
        ...base,
        tone: "warning",
        // The warning is about the window, so it shows at every width.
        tail: `${windowLabel(batch)}. This end day is outside it, so the save is refused.`,
        info: "A run stays in its credit batch. To move it, remove it from the batch on the credit batch page first.",
      };
    case "facility":
      return {
        ...base,
        tone: "warning",
        tail: ". It belongs to another facility, so the save is refused.",
        info: "A run stays in its credit batch. To move it, remove it from the batch on the credit batch page first.",
      };
    case "feedstock":
      return {
        ...base,
        tone: "warning",
        tail: ". These source bins hold another feedstock type, so the save is refused.",
        info: "A credit batch holds one feedstock type. To change the source bins, remove the run from the batch on the credit batch page first.",
      };
    case "reopen":
      return {
        ...base,
        tone: "warning",
        tail: ". Remove the run from the batch before reopening it.",
        info: null,
      };
  }
}

export function describeCreditBatchPreview(view: ProductionRunCreditBatchPreviewView): CreditBatchLineCopy {
  switch (view.state) {
    case "pending":
      return pendingLineCopy();
    case "error":
      return errorLineCopy();
    case "not-applicable":
      return {
        ...CREDIT_BATCH_LINE_BASE,
        lead: `Credit batch: ${MISSING_VALUE.notApplicable}`,
        info: "Failed and cancelled runs do not join a credit batch.",
      };
    case "incomplete":
      return {
        ...CREDIT_BATCH_LINE_BASE,
        lead: INCOMPLETE_LEAD[view.missing],
        info: view.missing === "facility" ? null : END_DAY_RULE,
      };
    case "mixed-feedstock":
      return {
        ...CREDIT_BATCH_LINE_BASE,
        tone: "warning",
        lead: `No credit batch: the source bins hold ${view.feedstockTypeCount} feedstock types.`,
        info: "A credit batch holds one feedstock type, so this run stays unassigned. You can still save it.",
      };
    case "member":
      return memberCopy(view);
    case "match":
      return {
        ...CREDIT_BATCH_LINE_BASE,
        lead: CREDIT_BATCH_LEAD,
        batches: [view.batch],
        window: windowLabel(view.batch),
        // "once completed" already marks a running run's batch as provisional; the ⓘ says the start day stood in.
        tail: view.expected ? " once completed" : byStartDay(view.basis),
        info: joinInfo(view.basis, view.expected),
      };
    case "locked":
      return {
        ...CREDIT_BATCH_LINE_BASE,
        tone: "warning",
        lead: view.expected ? "Expected credit batch " : "Credit batch ",
        batches: [view.batch],
        tail: ` is locked${byStartDay(view.basis)}, so the run ${view.expected ? "would stay" : "stays"} unassigned.`,
        info: provisional(
          view.basis,
          `Its Removal was submitted, so runs do not join it. If the registry returned the Removal for revision, the save checks again and the run can still join. You can save the run either way. ${matchedOn(view.basis)}`,
        ),
      };
    case "ambiguous":
      return {
        ...CREDIT_BATCH_LINE_BASE,
        tone: "warning",
        lead: `More than one credit batch covers ${formatDayString(view.basis.day)}${byStartDay(view.basis)}: `,
        batches: view.batches,
        tail: ".",
        info: provisional(
          view.basis,
          "The run joins none of them until only one batch covers this day. Change the batch windows on the credit batch page.",
        ),
      };
    case "no-match":
      return {
        ...CREDIT_BATCH_LINE_BASE,
        lead: `No credit batch covers ${formatDayString(view.basis.day)} yet${byStartDay(view.basis)}. ${view.expected ? "Once completed, the run" : "The run"} joins one when it is created.`,
        info: provisional(
          view.basis,
          `You can save the run. A credit batch created for its end day at ${view.basis.facilityName} with ${view.basis.feedstockTypeName} takes it in automatically.`,
        ),
      };
  }
}
