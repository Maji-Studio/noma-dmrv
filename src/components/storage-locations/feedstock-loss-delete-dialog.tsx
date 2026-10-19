"use client";

import { FormField, FormTextarea } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { RecordLossConflictError, useRemoveLoss } from "@/hooks/use-bin-movements";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";
import { useState } from "react";

const REASON_REQUIRED = "Enter why you delete this entry.";
const CONFLICT_MESSAGE = "This entry was already changed from this dialog. Close it and check the stock history.";

/**
 * Deletes a feedstock bin's Lost mass entry through a reversal: the mass goes
 * back into the bin and the history keeps the entry crossed out with the reason.
 * Mounted only while open, so every opening starts with a fresh request key.
 */
export function FeedstockLossDeleteDialog({ entry, storageLocationId, timeZone, onClose }: {
  entry: FeedstockLedgerEntry;
  storageLocationId: string;
  timeZone: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const removeLoss = useRemoveLoss();
  // One key per open dialog, so a double click replays instead of reversing twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [serverError, setServerError] = useState<string>();

  const confirm = async () => {
    if (!reason.trim()) {
      setReasonError(REASON_REQUIRED);
      return;
    }
    setServerError(undefined);
    try {
      await removeLoss.mutateAsync({ storageLocationId, correctsMovementId: entry.id, idempotencyKey, reason: reason.trim() });
      toast.success("Lost mass deleted");
      onClose();
    } catch (error) {
      if (error instanceof RecordLossConflictError) {
        setIdempotencyKey(crypto.randomUUID());
        setServerError(CONFLICT_MESSAGE);
        return;
      }
      setServerError(error instanceof Error ? error.message : "Lost mass was not deleted. Try again.");
    }
  };

  const massKg = entry.wetDeltaKg === null ? null : Math.abs(entry.wetDeltaKg);
  return (
    <DeleteConfirmDialog
      isOpen
      title="Delete lost mass"
      width="md"
      message={<>
        <p>{formatMassKg(massKg)} wet from {formatFacilityDateTime(entry.occurredAt, timeZone)} goes back into the bin.</p>
        <p className="body-caption">The stock history keeps the entry, crossed out, with your reason.</p>
      </>}
      onConfirm={confirm}
      onCancel={onClose}
      isPending={removeLoss.isPending}
      errorMessage={serverError}
    >
      <FormField id="loss-delete-reason" label="Reason" required error={reasonError} helperText="Such as recorded twice, or the wrong bin.">
        <FormTextarea id="loss-delete-reason" rows={2} value={reason} disabled={removeLoss.isPending} error={!!reasonError}
          onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(undefined); }} />
      </FormField>
    </DeleteConfirmDialog>
  );
}
