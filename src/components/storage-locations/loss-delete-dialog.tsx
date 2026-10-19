"use client";

import { FormField, FormTextarea } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { RecordLossConflictError, useRemoveLoss } from "@/hooks/use-bin-movements";
import { useRemoveOutputLoss } from "@/hooks/use-output-stock";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import type { RemoveLossData } from "@/schemas/bin-movements";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { useState } from "react";
import { outputEntryMass } from "./output-entry-mass";

const REASON_REQUIRED = "Enter why you delete this entry.";
const CONFLICT_MESSAGE = "This entry was already changed from this dialog. Close it and check the stock history.";

interface LossDeleteDialogProps {
  /** The entry's own size as the history shows it, such as "120 kg wet". */
  amount: string;
  occurredAt: string;
  storageLocationId: string;
  movementId: string;
  timeZone: string;
  remove: { mutateAsync: (data: RemoveLossData) => Promise<unknown>; isPending: boolean };
  onClose: () => void;
}

/**
 * Deletes a bin's Lost mass entry through a reversal: the mass goes back into
 * the bin and the history keeps the entry crossed out with the reason. Feedstock
 * and output bins share it. Mounted only while open, so every opening starts
 * with a fresh request key.
 */
function LossDeleteDialog({ amount, occurredAt, storageLocationId, movementId, timeZone, remove, onClose }: LossDeleteDialogProps) {
  const toast = useToast();
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
      await remove.mutateAsync({ storageLocationId, correctsMovementId: movementId, idempotencyKey, reason: reason.trim() });
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

  return (
    <DeleteConfirmDialog
      isOpen
      title="Delete lost mass"
      width="md"
      message={<>
        <p>{amount} from {formatFacilityDateTime(occurredAt, timeZone)} goes back into the bin.</p>
        <p className="body-caption">The stock history keeps the entry, crossed out, with your reason.</p>
      </>}
      onConfirm={confirm}
      onCancel={onClose}
      isPending={remove.isPending}
      errorMessage={serverError}
    >
      <FormField id="loss-delete-reason" label="Reason" required error={reasonError} helperText="Such as recorded twice, or the wrong bin.">
        <FormTextarea id="loss-delete-reason" rows={2} value={reason} disabled={remove.isPending} error={!!reasonError}
          onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(undefined); }} />
      </FormField>
    </DeleteConfirmDialog>
  );
}

interface EntryDialogProps<Entry> {
  entry: Entry;
  storageLocationId: string;
  timeZone: string;
  onClose: () => void;
}

/** A feedstock bin keeps wet mass, so the entry is always named by its wet kg. */
export function FeedstockLossDeleteDialog({ entry, ...props }: EntryDialogProps<FeedstockLedgerEntry>) {
  const remove = useRemoveLoss();
  const massKg = entry.wetDeltaKg === null ? null : Math.abs(entry.wetDeltaKg);
  return <LossDeleteDialog {...props} remove={remove} movementId={entry.id} occurredAt={entry.occurredAt} amount={`${formatMassKg(massKg)} wet`} />;
}

/** An output bin names the entry the way its history line does: wet when weighed wet, else dry. */
export function OutputLossDeleteDialog({ entry, ...props }: EntryDialogProps<OutputStockHistoryEntry>) {
  const remove = useRemoveOutputLoss();
  return <LossDeleteDialog {...props} remove={remove} movementId={entry.id} occurredAt={entry.occurredAt} amount={outputEntryMass(entry)} />;
}
