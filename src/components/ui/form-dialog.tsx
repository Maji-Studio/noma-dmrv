"use client";

import { useRef, useState } from "react";
import { Modal, type ModalProps } from "@/components/ui/modal";
import { DiscardChangesDialog } from "./discard-changes-dialog";
import { FormDialogContext, type DialogFormState } from "./form-dialog-context";

/** Modal with the same unsaved-changes confirmation as EntitySideSheet. */
export function FormDialog({
  onClose,
  children,
  discardDescription,
  ...props
}: ModalProps & { discardDescription?: string }) {
  const forms = useRef(new Map<object, DialogFormState>());
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    const states = [...forms.current.values()];
    if (states.some((state) => state.busy)) return;
    if (states.some((state) => state.dirty)) setConfirmingDiscard(true);
    else onClose();
  }

  const actions = {
    cancel: close,
    // A successful submit may close immediately, before RHF publishes reset.
    markSaved: (id: object) => {
      forms.current.set(id, { dirty: false, busy: false });
      setBusy([...forms.current.values()].some((form) => form.busy));
    },
    report: (id: object, state: DialogFormState | null) => {
      if (state) forms.current.set(id, state);
      else forms.current.delete(id);
      setBusy([...forms.current.values()].some((form) => form.busy));
    },
  };

  return (
    <Modal {...props} onClose={close} dismissible={!busy && props.dismissible !== false}>
      <FormDialogContext.Provider value={actions}>{children}</FormDialogContext.Provider>
      <DiscardChangesDialog
        isOpen={confirmingDiscard}
        onClose={() => setConfirmingDiscard(false)}
        onDiscard={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
        description={discardDescription}
      />
    </Modal>
  );
}
