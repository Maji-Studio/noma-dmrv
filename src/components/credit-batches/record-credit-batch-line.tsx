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

import { useRecordCreditBatchPreview } from "@/hooks/use-record-credit-batch-preview";
import { useRecordCreditBatches } from "@/hooks/use-record-credit-batches";
import { settledPreview, useSettledInput } from "@/hooks/use-settled-preview";
import type { RecordCreditBatchPreviewInput } from "@/schemas/record-credit-batches";
import { CreditBatchLine } from "./credit-batch-line";
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
  const { settled, settling } = useSettledInput(preview ?? null);
  const previewQuery = useRecordCreditBatchPreview(previewing ? settled : null);
  const query = previewing ? previewQuery : saved;
  const answer = settledPreview(settling, previewQuery);

  // Error first: a failed refetch keeps old data, which must not stay claimed.
  const view: RecordCreditBatchLineView = previewing
    ? !preview
      ? { state: "new" }
      : answer.state === "ready"
        ? { state: "preview", preview: answer.data }
        : answer
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
