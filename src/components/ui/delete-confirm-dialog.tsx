/**
 * Delete Confirmation Dialog
 * Accessible confirmation dialog for delete actions.
 *
 * Composes the shared `Modal` primitive so chrome, centering, backdrop, and
 * width tokens stay consistent with every other modal in the app.
 */
"use client";

import { useId, type ReactNode } from "react";
import { ServerError } from "@/components/forms/server-error";
import { Button, Modal } from "@/components/ui";

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  errorMessage?: string;
  confirmLabel?: string;
  pendingLabel?: string;
  /** What else the delete takes with it, shown under the message. */
  children?: ReactNode;
  /** Holds Delete while the dialog is still loading what it removes. */
  confirmDisabled?: boolean;
}

export function DeleteConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  isPending = false,
  errorMessage,
  confirmLabel = "Delete",
  pendingLabel = "Deleting...",
  children,
  confirmDisabled = false,
}: DeleteConfirmDialogProps) {
  const id = useId();
  const titleId = `${id}-delete-dialog-title`;
  const descId = `${id}-delete-dialog-desc`;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descId}
      width="sm"
    >
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
          <h2 id={titleId} className="title-heading-3">
            {title}
          </h2>
          <p
            id={descId}
            className="body-medium text-[var(--color-text-secondary)]"
          >
            {message}
          </p>
          {children}
        </div>
        <ServerError message={errorMessage} />
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
            disabled={isPending || confirmDisabled}
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
