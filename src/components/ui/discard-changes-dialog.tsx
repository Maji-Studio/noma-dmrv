"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/** The shared discard/keep-editing confirmation for sheets and form dialogs. */
export function DiscardChangesDialog({
  isOpen,
  onClose,
  onDiscard,
  description = "This form has changes that are not saved.",
}: {
  isOpen: boolean;
  onClose: () => void;
  onDiscard: () => void;
  description?: string;
}) {
  const titleId = useId();
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy={titleId} width="sm">
      <div className="flex flex-col gap-16">
        <h2 id={titleId} className="title-heading-4">Discard unsaved changes?</h2>
        <p className="body-small text-[var(--color-text-secondary)]">{description}</p>
        <div className="flex items-center justify-start gap-16">
          <Button variant="destructive" onClick={onDiscard}>Discard changes</Button>
          <Button variant="default" onClick={onClose}>Keep editing</Button>
        </div>
      </div>
    </Modal>
  );
}
