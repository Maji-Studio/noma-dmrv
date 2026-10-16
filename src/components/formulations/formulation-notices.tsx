/**
 * Notices for the formulation lifecycle: a delete refused because records use
 * the formulation, and the read-only banner of an archived one. Both resolve
 * through a neutral action (Archive instead, Restore), never a destructive one.
 */
"use client";

import { ArchiveIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

import { FORMULATION_IN_USE_PREFIX } from "@/lib/formulation-domain-errors";

/** True when `message` is the typed "in use" delete refusal. */
export function isFormulationInUseRefusal(message: string): boolean {
  return message.includes(FORMULATION_IN_USE_PREFIX);
}

export function FormulationDeleteConflictNotice({
  code,
  onArchive,
  isPending,
}: {
  code: string;
  onArchive: () => void;
  isPending: boolean;
}) {
  return (
    <Notice
      tone="warning"
      title={`${code} is in use and cannot be deleted.`}
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

export function ArchivedFormulationNotice({
  onRestore,
  isPending,
}: {
  onRestore: () => void;
  isPending: boolean;
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
      This formulation is archived. Pickers hide it and new products, orders and bins cannot use it.
    </Notice>
  );
}
