/**
 * Dialog shown when the server refuses a delete because records still use the
 * row. It replaces the confirm dialog: Archive instead is the primary action
 * (omit `onArchive` when archiving would be refused too or the row is already
 * archived: only Close shows and the explanation drops the archive suggestion).
 */
"use client";

import { useId, type ReactNode } from "react";
import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms/server-error";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SheetLinkRow, SheetLinkRows } from "@/components/ui/sheet-link-row";
import type { InUseRecordLink } from "@/lib/in-use-references";

interface InUseDeleteDialogProps {
  /** Names the row in the title: a code ("BCF-0003") or a name. */
  label: string;
  onClose: () => void;
  /** Archives the row. Leave out when archiving is not possible. */
  onArchive?: () => void;
  isPending?: boolean;
  /** Names what uses the row ("feedstock intakes still use it") in the default explanation, instead of "other records still use it". */
  reason?: string;
  /** The records that still use the row, linked between the two default paragraphs. */
  references?: ReadonlyArray<InUseRecordLink>;
  /** Blockers beyond the linked ones, shown as "and N more" after the links. */
  moreReferences?: number;
  errorMessage?: string | null;
  /** Replaces the default explanation. */
  children?: ReactNode;
}

/** A record that still uses the row, as a link the operator can open. */
export function InUseReference(reference: InUseRecordLink) {
  return <InUseReferences references={[reference]} />;
}

/** Several records that still use the row, one link each, in the order given. */
export function InUseReferences({ references, more = 0 }: { references: ReadonlyArray<InUseRecordLink>; more?: number }) {
  return (
    <>
      <SheetLinkRows>
        {references.map(({ href, code, kind }) => (
          <SheetLinkRow key={`${kind}:${code}`} href={href} primary={code} ariaLabel={`Open ${kind} ${code}`} />
        ))}
      </SheetLinkRows>
      {more > 0 && <p>{`and ${more} more`}</p>}
    </>
  );
}

export function InUseDeleteDialog({
  label,
  onClose,
  onArchive,
  isPending = false,
  reason = "other records still use it",
  references = [],
  moreReferences = 0,
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
                <p>{`${label} cannot be deleted because ${reason}.`}</p>
                {references.length > 0 && <InUseReferences references={references} more={moreReferences} />}
                {onArchive && <p>Archive it instead. Existing records keep it, while pickers hide it.</p>}
              </>
            )}
          </div>
        </div>
        <ServerError message={errorMessage ?? undefined} />
        <div className="flex gap-16 justify-start">
          {onArchive && (
            <Button size="large" variant="primary" onClick={onArchive} busy={isPending}>
              <ArchiveIcon size={16} weight="bold" />
              Archive instead
            </Button>
          )}
          <Button size="large" variant={onArchive ? "weak" : "primary"} onClick={onClose} disabled={isPending}>
            {onArchive ? "Cancel" : "Close"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
