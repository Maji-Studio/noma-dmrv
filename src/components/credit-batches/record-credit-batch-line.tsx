/**
 * The credit batch line for a saved or new Feedstock, Delivery or Application
 * (#1059 section 2). Create mode passes no id and never calls the server.
 */
"use client";

import { CreditBatchLine } from "./credit-batch-line";
import { useRecordCreditBatches } from "@/hooks/use-record-credit-batches";
import {
  describeRecordCreditBatchLine,
  type RecordCreditBatchKind,
  type RecordCreditBatchLineView,
} from "./record-credit-batch-line-copy";

interface RecordCreditBatchLineProps {
  kind: RecordCreditBatchKind;
  /** The saved record's ID; undefined while creating. */
  id?: string;
}

export function RecordCreditBatchLine({ kind, id }: RecordCreditBatchLineProps) {
  const query = useRecordCreditBatches(kind, id);
  // Error first: a failed refetch keeps old data, which must not stay claimed.
  const view: RecordCreditBatchLineView = !id
    ? { state: "new" }
    : query.isError
      ? { state: "error" }
      : query.data?.heldOut
        ? { state: "heldOut" }
        : query.data
          ? { state: "loaded", batches: query.data.batches }
          : { state: "pending" };

  return (
    <CreditBatchLine
      copy={describeRecordCreditBatchLine(kind, view)}
      retrying={query.isFetching}
      onRetry={() => void query.refetch()}
    />
  );
}
