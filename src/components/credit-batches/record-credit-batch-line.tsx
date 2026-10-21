/**
 * The credit batch line for a Feedstock, Delivery, Application or Biochar
 * Product form (#1059 section 2). A saved record reads its saved provenance.
 * An unsaved one passes `preview`: the source its form has chosen, and the
 * line names the batches saving would give it (#1350), worked out on the
 * server with the save path's own planner.
 *
 * Inputs settle for a moment before a check runs, and the line says
 * "Checking" whenever the last answer is not for the current inputs, so an
 * earlier source's batch never shows as current.
 */
"use client";

import { useDebounce } from "@/hooks/use-debounce";
import { useRecordCreditBatchPreview } from "@/hooks/use-record-credit-batch-preview";
import { useRecordCreditBatches } from "@/hooks/use-record-credit-batches";
import type { RecordCreditBatchPreviewInput } from "@/schemas/record-credit-batches";
import { CreditBatchLine } from "./credit-batch-line";
import { CREDIT_BATCH_PREVIEW_DEBOUNCE_MS } from "./credit-batch-line-copy";
import {
  describeRecordCreditBatchLine,
  type RecordCreditBatchKind,
  type RecordCreditBatchLineView,
} from "./record-credit-batch-line-copy";

interface RecordCreditBatchLineProps {
  kind: RecordCreditBatchKind;
  /** The saved record's ID; undefined while creating. */
  id?: string;
  /**
   * Preview from the form's source instead of reading saved provenance: null
   * while nothing that decides the batch is chosen. Undefined reads the saved
   * record, or says when a new feedstock's batch is set.
   */
  preview?: RecordCreditBatchPreviewInput | null;
  /** Opens batch links in this facility. */
  facilityId?: string | null;
}

export function RecordCreditBatchLine({ kind, id, preview, facilityId }: RecordCreditBatchLineProps) {
  const previewing = preview !== undefined;
  const saved = useRecordCreditBatches(kind, previewing ? undefined : id);
  // A string key: equal inputs stay equal across renders, so the debounce
  // settles, and the query key compares by value.
  const requestKey = JSON.stringify(preview ?? null);
  const settledKey = useDebounce(requestKey, CREDIT_BATCH_PREVIEW_DEBOUNCE_MS);
  const settled = JSON.parse(settledKey) as RecordCreditBatchPreviewInput | null;
  const previewQuery = useRecordCreditBatchPreview(previewing ? settled : null);
  const query = previewing ? previewQuery : saved;

  // Error first: a failed refetch keeps old data, which must not stay claimed.
  const view: RecordCreditBatchLineView = previewing
    ? !preview
      ? { state: "new" }
      : settledKey !== requestKey || previewQuery.isFetching
        ? { state: "pending" }
        : previewQuery.isError
          ? { state: "error" }
          : previewQuery.data
            ? { state: "preview", preview: previewQuery.data }
            : { state: "pending" }
    : !id
      ? { state: "new" }
      : saved.isError
        ? { state: "error" }
        : saved.data?.heldOut
          ? { state: "heldOut" }
          : saved.data
            ? { state: "loaded", batches: saved.data.batches }
            : { state: "pending" };

  return (
    <CreditBatchLine
      copy={describeRecordCreditBatchLine(kind, view)}
      facilityId={facilityId}
      retrying={query.isFetching}
      onRetry={() => void query.refetch()}
    />
  );
}
