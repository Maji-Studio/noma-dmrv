"use client";

import { useState } from "react";
import { FormField, FormTextarea } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useCorrectProductionRunReturn } from "@/hooks/use-production-run-returns";
import { ConflictError } from "@/lib/conflict-ref";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import type { ProductionRunReturnRow } from "@/data-access/production-run-returns/view";
import { REVERSE_CONFLICT_MESSAGE, REVERSE_REASON_HELPER, REVERSE_REASON_REQUIRED } from "./production-run-return-copy";

/**
 * Takes a return back out of its bin through a reversal. The history keeps the
 * entry, crossed out, with the reason. Mounted only while open, so every
 * opening starts with a fresh request key.
 */
export function ProductionRunReturnReverseDialog({ runId, entry, timeZone, onClose }: {
  runId: string;
  entry: ProductionRunReturnRow;
  timeZone: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const correct = useCorrectProductionRunReturn();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [serverError, setServerError] = useState<string>();

  const confirm = async () => {
    if (!reason.trim()) {
      setReasonError(REVERSE_REASON_REQUIRED);
      return;
    }
    setServerError(undefined);
    try {
      await correct.mutateAsync({ sourceProductionRunId: runId, storageLocationId: entry.storageLocationId, correctsMovementId: entry.id,
        idempotencyKey, reason: reason.trim(), replacement: null });
      toast.success("Return reversed");
      onClose();
    } catch (error) {
      if (error instanceof ConflictError && (error.code === undefined || error.code === "conflict")) {
        setIdempotencyKey(crypto.randomUUID());
        setServerError(REVERSE_CONFLICT_MESSAGE);
        return;
      }
      setServerError(error instanceof Error ? error.message : "The return was not reversed. Try again.");
    }
  };

  return (
    <DeleteConfirmDialog isOpen title="Reverse return" width="md" confirmLabel="Reverse return"
      message={<>
        <p>{formatMassKg(entry.wetMassKg)} wet mass from {formatFacilityDateTime(entry.occurredAt, timeZone)} comes out of {entry.destinationName ?? "the bin"}.</p>
        <p className="body-caption">The returns list keeps the entry, crossed out, with your reason.</p>
      </>}
      onConfirm={confirm} onCancel={onClose} isPending={correct.isPending} errorMessage={serverError}>
      <FormField id="return-reverse-reason" label="Reason" required error={reasonError} helperText={REVERSE_REASON_HELPER}>
        <FormTextarea id="return-reverse-reason" rows={2} value={reason} disabled={correct.isPending} error={!!reasonError}
          onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(undefined); }} />
      </FormField>
    </DeleteConfirmDialog>
  );
}
