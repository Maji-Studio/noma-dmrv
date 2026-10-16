/**
 * Notices shared by every list that can archive its records: a delete refused
 * because records still use the row, and the read-only banner of an archived
 * row. Both resolve through a neutral action (Archive instead, Restore), never
 * a destructive one.
 */
"use client";

import { ArchiveIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { IN_USE_DELETE_MARKER } from "@/lib/delete-refusal";

/** True when `message` is the typed "in use" delete refusal. */
export function isInUseDeleteRefusal(message: string): boolean {
  return message.includes(IN_USE_DELETE_MARKER);
}

/** `label` names the row in the title: a code ("BCF-0003") or a name. */
export function DeleteConflictNotice({
  label,
  onArchive,
  isPending,
}: {
  label: string;
  onArchive: () => void;
  isPending: boolean;
}) {
  return (
    <Notice
      tone="warning"
      title={`${label} is in use and cannot be deleted.`}
      action={
        <Button variant="default" size="small" onClick={onArchive} busy={isPending}>
          <ArchiveIcon size={16} weight="bold" />
          Archive instead
        </Button>
      }
    >
      Archive it instead. Existing records keep it, while pickers hide it.
    </Notice>
  );
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
