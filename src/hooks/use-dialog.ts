/**
 * useDialog hook
 * Encapsulates the native <dialog> showModal/close + ESC cancel pattern
 */

import { useEffect, useRef } from "react";

/**
 * Returns a ref to attach to a <dialog> element.
 * Automatically calls showModal()/close() when `isOpen` changes,
 * and intercepts the native cancel event (ESC key) to call `onClose`.
 *
 * Optional `onOpen` callback fires when the dialog opens (useful for resetting form state).
 */
export function useDialog(
  isOpen: boolean,
  onClose: () => void,
  onOpen?: () => void
) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      onOpen?.();
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
    // onOpen intentionally excluded — only react to isOpen changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return dialogRef;
}
