/**
 * The bar after deleting a manual entry: what happened and Undo.
 * The shared toast has no action slot, so this is its own small bar.
 */
"use client";

import { useEffect } from "react";
import { XIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Long enough to read the message and reach Undo. */
export const UNDO_VISIBLE_MS = 10_000;

interface EmissionsUndoBarProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  undoing?: boolean;
  /** Sits in the flow under the affected row instead of floating. Either way Undo takes focus: the deleted entry's menu is gone. */
  inline?: boolean;
}

export function EmissionsUndoBar({ message, onUndo, onDismiss, undoing, inline }: EmissionsUndoBarProps) {
  // External-system sync: a timer that dismisses the bar. Remount (key) to restart it.
  useEffect(() => {
    if (undoing) return;
    const timer = window.setTimeout(onDismiss, UNDO_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  });
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-12 gap-y-8 bg-[var(--paper)] px-16 py-10 [border:var(--hair)]",
        inline
          ? "mx-16 mb-12"
          : "fixed bottom-24 left-1/2 z-[var(--z-layer-toast)] w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2",
      )}
    >
      <span className="min-w-0 flex-1 basis-[240px] body-small">{message}</span>
      <span className="flex items-center gap-8">
        <Button size="small" variant="default" busy={undoing} onClick={onUndo} autoFocus>
          Undo
        </Button>
        <Button size="icon" variant="noOutline" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon size={16} weight="bold" aria-hidden="true" />
        </Button>
      </span>
    </div>
  );
}
