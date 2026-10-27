/**
 * Delete Confirmation Dialog
 * Accessible confirmation dialog for delete actions.
 *
 * Composes the shared `Modal` primitive so chrome, centering, backdrop, and
 * width tokens stay consistent with every other modal in the app.
 */
"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { ServerError } from "@/components/forms/server-error";
import { Button, Modal } from "@/components/ui";

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Plain text, or a lead line plus a quieter second line. */
  message: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Spinner on the confirm button; its label stays. Hold it until the result shows (docs/design-system.md, Button). */
  isPending?: boolean;
  errorMessage?: string;
  confirmLabel?: string;
  /** What else the delete takes with it, shown under the message. */
  children?: ReactNode;
  /** Holds Delete while the dialog is still loading what it removes. */
  confirmDisabled?: boolean;
  /** Modal width token; confirmations stay `sm`, dialogs with a list use `md`. */
  width?: ComponentProps<typeof Modal>["width"];
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
  children,
  confirmDisabled = false,
  width = "sm",
}: DeleteConfirmDialogProps) {
  const id = useId();
  const titleId = `${id}-delete-dialog-title`;
  const descId = `${id}-delete-dialog-desc`;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      // A request in flight, or the navigation that follows it, cannot be dismissed.
      dismissible={!isPending}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descId}
      width={width}
    >
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
          <h2 id={titleId} className="title-heading-3">
            {title}
          </h2>
          <div
            id={descId}
            className="body-medium text-[var(--color-text-secondary)]"
          >
            {message}
          </div>
          {children}
        </div>
        <ServerError message={errorMessage} />
        <div className="flex gap-16 justify-start">
          <Button
            size="large"
            variant="default"
            className="bg-[var(--color-signal-red)] text-white border-[var(--color-signal-red)] hover:opacity-90"
            onClick={onConfirm}
            disabled={confirmDisabled}
            busy={isPending}
          >
            {confirmLabel}
          </Button>
          <Button
            size="large"
            variant="default"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
