/**
 * Delete Confirmation Dialog
 * Accessible confirmation dialog for delete actions.
 *
 * Composes the shared `Modal` primitive so chrome, centering, backdrop, and
 * width tokens stay consistent with every other modal in the app.
 */
"use client";

import { Button, Modal } from "@/components/ui";

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
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabelledBy="delete-dialog-title"
      ariaDescribedBy="delete-dialog-description"
      width="sm"
    >
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
          <h2 id="delete-dialog-title" className="title-heading-3">
            {title}
          </h2>
          <p
            id="delete-dialog-description"
            className="body-medium text-[var(--color-text-secondary)]"
          >
            {message}
          </p>
        </div>
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
    </Modal>
  );
}
