/**
 * The words of the Lab Sample footer's credit batch line (#1059 section 2).
 * A Sample characterises the one credit batch chosen in the form, so the line
 * repeats that choice next to Save. Pure, so both states are tested without a
 * server.
 */
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  CREDIT_BATCH_LINE_BASE,
  errorLineCopy,
  missingLineCopy,
  pendingLineCopy,
  type CreditBatchLineCopy,
} from "@/components/credit-batches/credit-batch-line-copy";

export const SAMPLE_CREDIT_BATCH_INFO_LABEL = "Which credit batch this Sample belongs to";

const SELECTED_INFO = "This Sample characterises the credit batch chosen above.";
const UNAVAILABLE_INFO = "This credit batch could not be found. Choose another credit batch above.";
const EMPTY_INFO = "Choose a credit batch above. A Sample characterises one credit batch.";

export type SampleCreditBatchLineView =
  | { state: "empty" }
  | { state: "pending" }
  | { state: "error" }
  /** The lookup succeeded but the batch is gone. */
  | { state: "unavailable" }
  | { state: "selected"; batch: { id: string; code: string } };

export function describeSampleCreditBatchLine(view: SampleCreditBatchLineView): CreditBatchLineCopy {
  const copy = describeUnlabeled(view);
  return { ...copy, infoLabel: SAMPLE_CREDIT_BATCH_INFO_LABEL };
}

function describeUnlabeled(view: SampleCreditBatchLineView): CreditBatchLineCopy {
  switch (view.state) {
    case "empty":
      return missingLineCopy(MISSING_VALUE.notSet, EMPTY_INFO);
    case "pending":
      return pendingLineCopy();
    case "error":
      return errorLineCopy();
    case "unavailable":
      return missingLineCopy(MISSING_VALUE.notAvailable, UNAVAILABLE_INFO);
    case "selected":
      return { ...CREDIT_BATCH_LINE_BASE, lead: "Credit batch: ", batches: [view.batch], info: SELECTED_INFO };
  }
}
