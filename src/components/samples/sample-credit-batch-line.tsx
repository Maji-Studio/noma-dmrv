/**
 * The Lab Sample form's credit batch line: repeats the batch chosen higher in
 * the form next to Save (#1059 section 2). The code comes from the batch
 * summary the form already loads, so this adds no request of its own.
 */
"use client";

import { CreditBatchLine } from "@/components/credit-batches/credit-batch-line";
import { useBatchDurabilitySummary } from "@/hooks/use-certification";
import {
  describeSampleCreditBatchLine,
  type SampleCreditBatchLineView,
} from "./sample-credit-batch-line-copy";

interface SampleCreditBatchLineProps {
  /** The form's currently-selected credit batch. */
  creditBatchId: string | undefined;
  facilityId?: string | null;
}

export function SampleCreditBatchLine({ creditBatchId, facilityId }: SampleCreditBatchLineProps) {
  const summary = useBatchDurabilitySummary(creditBatchId || "", !!creditBatchId);
  const view: SampleCreditBatchLineView = !creditBatchId
    ? { state: "empty" }
    : summary.data
      ? { state: "selected", batch: { id: creditBatchId, code: summary.data.creditBatchCode } }
      : summary.isError
        ? { state: "error" }
        : { state: "pending" };

  return (
    <CreditBatchLine
      copy={describeSampleCreditBatchLine(view)}
      facilityId={facilityId}
      retrying={summary.isFetching}
      onRetry={() => void summary.refetch()}
    />
  );
}
