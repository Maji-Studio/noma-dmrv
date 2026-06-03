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
  // The element that held focus when the dialog opened, so focus can return
  // there on close. Native <dialog> restores focus for method="dialog" closes
  // but NOT when close() is driven by React state (our path), leaving keyboard
  // and screen-reader users stranded at the document start. We restore it.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        // Capture before showModal() moves focus into the dialog.
        triggerRef.current = document.activeElement as HTMLElement | null;
        dialog.showModal();
      }
      onOpen?.();
    } else {
      if (dialog.open) {
        dialog.close();
      }
      // Restore focus only if the trigger is still in the document and
      // focusable; guards against returning focus to a since-unmounted node.
      const trigger = triggerRef.current;
      if (
        trigger &&
        typeof trigger.focus === "function" &&
        document.contains(trigger)
      ) {
        trigger.focus();
      }
      triggerRef.current = null;
    }
    // onOpen intentionally excluded — only react to isOpen changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Pin onClose via a ref so the cancel-listener effect doesn't churn on
  // every parent render. Every consumer passes `onClose` as an inline arrow,
  // so without the ref each parent re-render (typing in a form, sibling
  // state churn) would tear down and re-add the listener.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Depend on `isOpen` (not `[]`) because `Modal` returns null while closed,
  // so the <dialog> element doesn't exist on the hook's first mount. Without
  // re-running on open, the cancel listener never attaches and ESC closes
  // the native dialog without notifying React state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [isOpen]);

  return dialogRef;
}
