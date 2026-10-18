/**
 * The body of an open line row, on the row's own column grid: the sources
 * table (records, manual entries, Total), the line comment as one more row
 * joined to it, then the line's actions (Add manual entry, Add comment) as
 * one quiet group. Records are
 * read-only and link to where they are made; each manual entry carries its
 * own ⋯. Add and Edit open the entry form panel. The line description sits
 * behind the ⓘ beside the line name in the row.
 */
"use client";

import { ChatTextIcon } from "@phosphor-icons/react/dist/ssr";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { cn } from "@/lib/utils";
import { AddEntryLink, ICON, NothingYet, QuietAction, ReviewNotice, SetupNotice, lineBodyModel } from "./emission-line-body-parts";
import { LineComment } from "./emission-line-comment";
import type { EmissionEntry, EmissionLine } from "./emission-line-display";
import { NAME_INSET, TABLE_ROW } from "./emission-line-grid";
import { SourcesTable } from "./emission-line-sources-table";
import type { EntryFormMode } from "./manual-entry-form";

/** Text in the body runs from Line across to Sources, never under Total. */
const TEXT_CELL = cn("col-span-3 min-w-0 md:col-span-3", NAME_INSET);

interface AccordionBodyProps {
  id: string;
  line: EmissionLine;
  scope: EmissionBatchScope;
  canWrite: boolean;
  editingComment: boolean;
  onEditingComment: (editing: boolean) => void;
  onForm: (mode: EntryFormMode) => void;
  onDeleteEntry: (line: EmissionLine, entry: EmissionEntry) => void;
}

export function EmissionLineAccordionBody({ id, line, scope, canWrite, editingComment, onEditingComment, onForm, onDeleteEntry }: AccordionBodyProps) {
  const model = lineBodyModel(line, canWrite);
  const setup = line.state === "needsSetup";
  // A line removed from the template takes no comment; the server refuses one.
  const addComment = canWrite && !setup && !line.removedFromTemplate && !line.comment && !editingComment;
  return (
    <div id={id} role="region" aria-label={`${line.displayName} details`} className="flex flex-col pb-10">
      {(setup || model.reviewWithoutEntries) && (
        <div className={cn(TABLE_ROW, "pb-12")}>
          <div className={TEXT_CELL}>{setup ? <SetupNotice scope={scope} /> : <ReviewNotice line={line} scope={scope} />}</div>
        </div>
      )}
      {!setup && (model.nothingYet ? (
        <div className={cn(TABLE_ROW, "pb-10")}>
          <NothingYet line={line} className={TEXT_CELL} />
        </div>
      ) : (
        <SourcesTable line={line} scope={scope} canWrite={canWrite} model={model} onForm={onForm} onDeleteEntry={onDeleteEntry} />
      ))}
      {!setup && <LineComment line={line} scope={scope} canWrite={canWrite} editing={editingComment} onEditingChange={onEditingComment} />}
      {(model.canAddInBody || addComment) && (
        <div className={cn(TABLE_ROW, "pt-10")}>
          <div className={cn(TEXT_CELL, "flex flex-wrap items-center gap-x-24 gap-y-4")}>
            {model.canAddInBody && <AddEntryLink line={line} onAdd={() => onForm({ kind: "add" })} />}
            {addComment && (
              <QuietAction icon={<ChatTextIcon size={ICON} aria-hidden="true" />} onClick={() => onEditingComment(true)}>
                Add comment
              </QuietAction>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
