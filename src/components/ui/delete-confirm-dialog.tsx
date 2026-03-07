/**
 * Delete Confirmation Dialog
 * Accessible confirmation dialog for delete actions
 */
"use client";

import { useDialog } from "@/hooks/use-dialog";
import { Button } from "@/components/ui";

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function DeleteConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  isPending = false,
}: DeleteConfirmDialogProps) {
  const dialogRef = useDialog(isOpen, onCancel);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-32 border border-[var(--color-border-primary)] backdrop:bg-black/50"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      <div className="flex flex-col gap-24 min-w-[300px]">
        <h2 id="dialog-title" className="title-heading-3">
          {title}
        </h2>
        <p id="dialog-description" className="body-medium text-[var(--color-text-secondary)]">
          {message}
        </p>
        <div className="flex gap-16 justify-end">
          <Button
            size="large"
            variant="default"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="large"
            variant="default"
            className="bg-[var(--color-signal-red)] text-white border-[var(--color-signal-red)] hover:opacity-90"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
