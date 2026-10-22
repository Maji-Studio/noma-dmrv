/**
 * The words of the Feedstock, Delivery, Application and Biochar Product forms' credit batch
 * line (#1059 section 2, #1350). A record's batches follow its provenance
 * (the production runs behind it), never its own date. Before saving, the
 * Delivery, Application and Product forms preview the batches from the source
 * the operator chose; the Feedstock form says when its batch is set. Pure, so
 * every state is tested without a server.
 */
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDateRange } from "@/lib/format-utils";
import type { RecordCreditBatchPreview } from "@/types/record-credit-batches";
import {
  CREDIT_BATCH_LINE_BASE,
  errorLineCopy,
  missingLineCopy,
  pendingLineCopy,
  unknownLineCopy,
  type CreditBatchLineBatch,
  type CreditBatchLineCopy,
} from "./credit-batch-line-copy";

export type RecordCreditBatchKind = "feedstock" | "delivery" | "application" | "biochar-product";
/** The records whose form previews its batches from a chosen source. */
export type PreviewedRecordKind = Exclude<RecordCreditBatchKind, "feedstock">;

export type RecordCreditBatchLineView =
  /** Unsaved, and nothing that decides the batch is chosen yet. */
  | { state: "new" }
  | { state: "pending" }
  | { state: "error" }
  /** A mix-bin application, held out of credit batches (ADR 0030). */
  | { state: "heldOut" }
  | { state: "loaded"; batches: CreditBatchLineBatch[] }
  /** Unsaved, with a source chosen: what saving would do (#1350). */
  | { state: "preview"; preview: RecordCreditBatchPreview };

/** Feedstock joins no batch itself; its runs do (decision 2026-10-21). */
export const FEEDSTOCK_NEW_LEAD = "Credit batch: Set when a production run uses this feedstock";

const RULE_INFO: Record<RecordCreditBatchKind, string> = {
  feedstock: "Credit batches are determined by the production runs that use this feedstock.",
  delivery: "Credit batches follow the production runs that produced the delivered biochar.",
  application: "Credit batches follow the production runs that produced the applied biochar.",
  "biochar-product": "Credit batches follow the production runs that produced this biochar product.",
};

const NONE_INFO: Record<RecordCreditBatchKind, string> = {
  feedstock: "No production run that uses this feedstock is in a credit batch yet.",
  delivery: "No production run that produced the delivered biochar is in a credit batch yet.",
  application: "No production run that produced the applied biochar is in a credit batch yet.",
  "biochar-product": "No production run that produced this biochar product is in a credit batch yet.",
};

const HELD_OUT_INFO = "This application's biochar was drawn from a mix bin, so it is held out of credit batches.";

/** The field that decides the batch, as the form labels it. */
const SOURCE: Record<PreviewedRecordKind, string> = {
  delivery: "an actual source bin",
  application: "a delivery",
  "biochar-product": "a biochar bin",
};

/** The chosen source, opening a sentence. */
const THE_SOURCE: Record<PreviewedRecordKind, string> = {
  delivery: "The actual source bin holds",
  application: "This delivery has",
  "biochar-product": "The biochar bin holds",
};

const RECORD: Record<PreviewedRecordKind, string> = {
  delivery: "this delivery",
  application: "this application",
  "biochar-product": "this product",
};

/** What the operator still enters before the draw is planned, in the form's own labels. */
const STILL_TO_ENTER: Record<PreviewedRecordKind, string> = {
  delivery: "Enter the biochar product wet mass and moisture",
  application: "Enter the biochar product applied",
  "biochar-product": "Enter the biochar wet mass and moisture",
};

const EMPTY_SOURCE_INFO: Record<PreviewedRecordKind, string> = {
  delivery: "The actual source bin holds no biochar at this time, so there is no credit batch to join.",
  application: "This delivery has no biochar left to apply, so there is no credit batch to join.",
  "biochar-product": "The biochar bin holds no biochar at this time, so there is no credit batch to join.",
};

/** The entered draw or amount would be refused: no batch is claimed, and nothing is asked for twice. */
const REFUSED_INFO: Record<PreviewedRecordKind, string> = {
  delivery: "The save would refuse this load as entered, so its credit batch is not worked out. The stock message in the form says why.",
  application: "The save would refuse this amount for this delivery, so its credit batch is not worked out.",
  "biochar-product": "The save would refuse this biochar draw as entered, so its credit batch is not worked out. The stock message in the form says why.",
};

/** Only an application reads a delivery's saved stock allocation. */
const UNTRACEABLE_INFO = "This delivery's saved stock allocation is missing or does not balance, so its credit batch cannot be worked out.";

const PREVIEW_HELD_OUT_INFO = "This delivery's biochar was drawn from a mix bin, so this application is held out of credit batches.";

const SOME_UNBATCHED = " Some of the biochar comes from production runs that are in no credit batch yet.";

/** Unknown lines say what unblocks them instead of "Not yet computed". */
const REFUSED_LEAD_TOKEN = "Shown once the amount can be saved";
const UNTRACEABLE_LEAD_TOKEN = "Can't be traced for this delivery";

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every batch the record could end up in is the same one, or none. */
function isSettled(preview: RecordCreditBatchPreview): boolean {
  const outcomes = preview.batches.length + (preview.unbatchedRunCount > 0 ? 1 : 0);
  return preview.basis === "planned" || outcomes <= 1;
}

function previewCopy(kind: PreviewedRecordKind, preview: RecordCreditBatchPreview): CreditBatchLineCopy {
  if (preview.basis === "refused") return unknownLineCopy(REFUSED_LEAD_TOKEN, REFUSED_INFO[kind]);
  if (preview.basis === "untraceable") return unknownLineCopy(UNTRACEABLE_LEAD_TOKEN, UNTRACEABLE_INFO);
  if (preview.heldOut) return missingLineCopy(MISSING_VALUE.notApplicable, PREVIEW_HELD_OUT_INFO);
  if (preview.sourceRunCount === 0) return missingLineCopy(MISSING_VALUE.none, EMPTY_SOURCE_INFO[kind]);
  const { batches } = preview;
  const plural = batches.length > 1;
  if (!isSettled(preview)) {
    // Two possible batches (or one and "none") read as "A or B" / "A or none".
    const unbatched = preview.unbatchedRunCount > 0;
    const outcomes = batches.length + (unbatched ? 1 : 0);
    const holds = plural
      ? "biochar from more than one credit batch"
      : "biochar from this credit batch and from production runs that are in none yet";
    return {
      ...CREDIT_BATCH_LINE_BASE,
      lead: outcomes > 2 ? "Credit batches: " : "Credit batch: ",
      batches,
      ...(outcomes === 2 && batches.length === 2 ? { batchJoin: "or" as const } : {}),
      tail: outcomes === 2 && batches.length === 1 ? " or none" : "",
      info: `${THE_SOURCE[kind]} ${holds}. ${STILL_TO_ENTER[kind]} to see which credit ${plural ? "batches" : "batch"} ${RECORD[kind]} joins.`,
    };
  }
  if (batches.length === 0) {
    return missingLineCopy(
      MISSING_VALUE.none,
      `${NONE_INFO[kind]} ${sentence(RECORD[kind])} joins one when a credit batch takes in those runs.`,
    );
  }
  const [only] = batches;
  return {
    ...CREDIT_BATCH_LINE_BASE,
    lead: plural ? "Credit batches: " : "Credit batch: ",
    batches,
    // One batch names its window; several list theirs behind "+N".
    window: !plural && only.startDate && only.endDate ? ` (${formatDateRange(only.startDate, only.endDate)})` : "",
    info: preview.unbatchedRunCount > 0 ? `${RULE_INFO[kind]}${SOME_UNBATCHED}` : RULE_INFO[kind],
  };
}

export function describeRecordCreditBatchLine(
  kind: RecordCreditBatchKind,
  view: RecordCreditBatchLineView,
): CreditBatchLineCopy {
  switch (view.state) {
    case "new":
      if (kind === "feedstock") return { ...CREDIT_BATCH_LINE_BASE, lead: FEEDSTOCK_NEW_LEAD };
      return { ...CREDIT_BATCH_LINE_BASE, lead: `Choose ${SOURCE[kind]} to see the credit batch.`, info: RULE_INFO[kind] };
    case "heldOut":
      return missingLineCopy(MISSING_VALUE.notApplicable, HELD_OUT_INFO);
    case "pending":
      return pendingLineCopy();
    case "error":
      return errorLineCopy();
    case "preview":
      // A feedstock never previews; its runs decide later.
      return kind === "feedstock" ? { ...CREDIT_BATCH_LINE_BASE, lead: FEEDSTOCK_NEW_LEAD } : previewCopy(kind, view.preview);
    case "loaded": {
      const { batches } = view;
      if (batches.length === 0) return missingLineCopy(MISSING_VALUE.none, NONE_INFO[kind]);
      return {
        ...CREDIT_BATCH_LINE_BASE,
        lead: batches.length === 1 ? "Credit batch: " : "Credit batches: ",
        batches,
        info: RULE_INFO[kind],
      };
    }
  }
}
