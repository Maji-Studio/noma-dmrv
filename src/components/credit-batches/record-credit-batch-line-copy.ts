/**
 * The words of the Feedstock, Delivery, Application and Biochar Product forms' credit batch
 * line (#1059 section 2). A record's batches follow its provenance (the
 * production runs behind it), never its own date. An unsaved record never
 * resolves them. Pure, so every state is tested without a server.
 */
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  CREDIT_BATCH_LINE_BASE,
  errorLineCopy,
  missingLineCopy,
  pendingLineCopy,
  type CreditBatchLineBatch,
  type CreditBatchLineCopy,
} from "./credit-batch-line-copy";

export type RecordCreditBatchKind = "feedstock" | "delivery" | "application" | "biochar-product";

export type RecordCreditBatchLineView =
  | { state: "new" }
  | { state: "pending" }
  | { state: "error" }
  /** A mix-bin application, held out of credit batches (ADR 0030). */
  | { state: "heldOut" }
  | { state: "loaded"; batches: CreditBatchLineBatch[] };

const NEW_INFO: Record<RecordCreditBatchKind, string> = {
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

export function describeRecordCreditBatchLine(
  kind: RecordCreditBatchKind,
  view: RecordCreditBatchLineView,
): CreditBatchLineCopy {
  switch (view.state) {
    case "new":
      return missingLineCopy(MISSING_VALUE.notYetComputed, NEW_INFO[kind]);
    case "heldOut":
      return missingLineCopy(MISSING_VALUE.notApplicable, HELD_OUT_INFO);
    case "pending":
      return pendingLineCopy();
    case "error":
      return errorLineCopy();
    case "loaded": {
      const { batches } = view;
      if (batches.length === 0) return missingLineCopy(MISSING_VALUE.none, NONE_INFO[kind]);
      return {
        ...CREDIT_BATCH_LINE_BASE,
        lead: batches.length === 1 ? "Credit batch: " : "Credit batches: ",
        batches,
        info: NEW_INFO[kind],
      };
    }
  }
}
