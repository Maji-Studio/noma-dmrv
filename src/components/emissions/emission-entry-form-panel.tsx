/**
 * The side panel that holds the manual entry form (add, edit, enter again).
 * Reading a line happens in its accordion row; only the form needs a panel.
 */
"use client";

import { SlideOverPanelContent, SlideOverPanelRoot } from "@/components/ui/slide-over-panel";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import type { EmissionBatch, EmissionLine } from "./emission-line-display";
import { ManualEntryForm, type EntryFormMode } from "./manual-entry-form";

interface EmissionEntryFormPanelProps {
  line: EmissionLine | null;
  mode: EntryFormMode | null;
  batch: EmissionBatch;
  scope: EmissionBatchScope;
  today: string;
  onClose: () => void;
  /** Called after a save; `warning` when the entry saved but its file did not. */
  onSaved: (line: EmissionLine, warning?: string) => void;
}

export function EmissionEntryFormPanel({ line, mode, batch, scope, today, onClose, onSaved }: EmissionEntryFormPanelProps) {
  return (
    <SlideOverPanelRoot open={!!line && !!mode} onOpenChange={(open) => !open && onClose()}>
      <SlideOverPanelContent size="default">
        {line && mode && (
          <ManualEntryForm
            key={`${line.componentId}-${mode.kind}-${mode.kind === "add" ? "" : mode.entry.id}`}
            line={line}
            batch={batch}
            scope={scope}
            today={today}
            mode={mode}
            onCancel={onClose}
            onSaved={({ warning }) => {
              onClose();
              onSaved(line, warning);
            }}
          />
        )}
      </SlideOverPanelContent>
    </SlideOverPanelRoot>
  );
}
