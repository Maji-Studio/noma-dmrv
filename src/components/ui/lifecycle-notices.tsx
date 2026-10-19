/**
 * Shared by every list that can archive its records: the typed "in use" delete
 * refusal check (the refusal itself is an `InUseDeleteDialog`) and the
 * read-only banner of an archived row, which resolves through Restore.
 */
"use client";

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { IN_USE_DELETE_MARKER } from "@/lib/delete-refusal";

/** True when `message` is the typed "in use" delete refusal. */
export function isInUseDeleteRefusal(message: string): boolean {
  return message.includes(IN_USE_DELETE_MARKER);
}

/** `children` says what an archived row of this kind can no longer be used for. */
export function ArchivedRecordNotice({
  onRestore,
  isPending,
  children,
}: {
  onRestore: () => void;
  isPending: boolean;
  children: React.ReactNode;
}) {
  return (
    <Notice
      tone="info"
      action={
        <Button variant="default" size="small" onClick={onRestore} busy={isPending}>
          <ArrowCounterClockwiseIcon size={16} weight="bold" />
          Restore
        </Button>
      }
    >
      {children}
    </Notice>
  );
}
