/**
 * The words of the Lab Sample footer's credit batch line (#1059 section 2).
 * A sample characterizes the one credit batch chosen in the form, so the line
 * repeats that choice next to Save. Pure, so both states are tested without a
 * server.
 */
import {
  CREDIT_BATCH_LINE_BASE,
  errorLineCopy,
  notYetDeterminedLineCopy,
  pendingLineCopy,
  type CreditBatchLineCopy,
} from "@/components/credit-batches/credit-batch-line-copy";

export const SAMPLE_CREDIT_BATCH_INFO_LABEL = "Which credit batch this sample belongs to";

const SELECTED_INFO = "This sample characterizes the credit batch chosen above.";
const EMPTY_INFO = "Choose a credit batch above. A sample characterizes one credit batch.";

export type SampleCreditBatchLineView =
  | { state: "empty" }
  | { state: "pending" }
  | { state: "error" }
  | { state: "selected"; batch: { id: string; code: string } };

export function describeSampleCreditBatchLine(view: SampleCreditBatchLineView): CreditBatchLineCopy {
  const copy = describeUnlabeled(view);
  return { ...copy, infoLabel: SAMPLE_CREDIT_BATCH_INFO_LABEL };
}

function describeUnlabeled(view: SampleCreditBatchLineView): CreditBatchLineCopy {
  switch (view.state) {
    case "empty":
      return notYetDeterminedLineCopy(EMPTY_INFO);
    case "pending":
      return pendingLineCopy();
    case "error":
      return errorLineCopy();
    case "selected":
      return { ...CREDIT_BATCH_LINE_BASE, lead: "Credit batch: ", batches: [view.batch], info: SELECTED_INFO };
  }
}
