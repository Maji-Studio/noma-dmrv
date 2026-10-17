/**
 * Dialog shown when the server refuses a delete because records still use the
 * row. It replaces the confirm dialog: Archive instead is the primary action
 * (omit `onArchive` when archiving would be refused too, and only Close shows).
 */
"use client";

import { useId, type ReactNode } from "react";
import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms/server-error";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface InUseDeleteDialogProps {
  /** Names the row in the title: a code ("BCF-0003") or a name. */
  label: string;
  onClose: () => void;
  /** Archives the row. Leave out when archiving is not possible. */
  onArchive?: () => void;
  isPending?: boolean;
  errorMessage?: string | null;
  /** Replaces the default explanation. */
  children?: ReactNode;
}

export function InUseDeleteDialog({
  label,
  onClose,
  onArchive,
  isPending = false,
  errorMessage,
  children,
}: InUseDeleteDialogProps) {
  const id = useId();
  const titleId = `${id}-in-use-title`;
  const descId = `${id}-in-use-desc`;
  return (
    <Modal isOpen onClose={onClose} ariaLabelledBy={titleId} ariaDescribedBy={descId} width="md">
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
          <h2 id={titleId} className="title-heading-3">
            {`${label} is in use`}
          </h2>
          <div id={descId} className="flex flex-col gap-8 body-medium text-[var(--color-text-secondary)]">
            {children ?? (
              <>
                <p>{`${label} cannot be deleted because other records still use it.`}</p>
                <p>Archive it instead. Existing records keep it, while pickers hide it.</p>
              </>
            )}
          </div>
        </div>
        <ServerError message={errorMessage ?? undefined} />
        <div className="flex gap-16 justify-start">
          {onArchive && (
            <Button size="large" variant="default" onClick={onArchive} busy={isPending}>
              <ArchiveIcon size={16} weight="bold" />
              Archive instead
            </Button>
          )}
          <Button size="large" variant="default" onClick={onClose} disabled={isPending}>
            {onArchive ? "Cancel" : "Close"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
