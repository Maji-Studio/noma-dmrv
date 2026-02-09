/**
 * Delete Confirmation Dialog
 * Accessible confirmation dialog for delete actions
 */
"use client";

import { useEffect, useRef } from "react";

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
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onCancel]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-l rounded-[var(--radius-8)] border border-[var(--color-border-primary)] backdrop:bg-black/50"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      <div className="flex flex-col gap-m min-w-[300px]">
        <h2 id="dialog-title" className="title-heading-3">
          {title}
        </h2>
        <p id="dialog-description" className="body-medium text-[var(--color-text-secondary)]">
          {message}
        </p>
        <div className="flex gap-s justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-m py-xs border border-[var(--color-border-primary)] rounded-lg hover:bg-[var(--color-background-medium)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="px-m py-xs bg-[var(--color-signal-red)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
