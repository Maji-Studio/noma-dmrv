/**
 * The sources table of an open line: every part that adds to the line is one
 * row, records first, then the manual entries, then the Total when two or
 * more parts add up. It runs on the row's own column grid, so Date sits under
 * State, Files and note under Sources, Amount under Total and each entry's ⋯
 * under the row's ⋯. "Manual entries" names the group once; the rows under it
 * are told apart by their dates. Phones fold the date under the source and
 * the files and note under the row.
 */
"use client";

import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms/server-error";
import { Button } from "@/components/ui";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import { EntryEvidence, ICON, RecordsSourceLink, entryAmount, lineBodyModel, useEntryActions } from "./emission-line-body-parts";
import { formatFigure, hasRecordsFigure, type EmissionEntry, type EmissionLine } from "./emission-line-display";
import { EntryMenu, entryDateText, stoppedEntryMessage, useStoppedEntry } from "./emission-ledger-entries";
import { NAME_INSET, TABLE_ROW } from "./emission-line-grid";
import type { EntryFormMode } from "./manual-entry-form";

const CELL_Y = "py-10";
const SOURCE_CELL = cn("col-start-1 row-start-1 flex min-w-0 flex-col", CELL_Y, NAME_INSET);
const DATE_CELL = cn("hidden md:col-start-2 md:row-start-1 md:block body-small text-[var(--color-text-secondary)]", CELL_Y);
const AMOUNT_CELL = cn("col-start-2 row-start-1 md:col-start-4 flex flex-col items-end text-right body-small tabular-nums", CELL_Y);
/** The ⋯ centres on the first text line without making the row taller. */
const MENU_CELL = "col-start-3 row-start-1 md:col-start-5 -mt-2 -mb-12 flex justify-end self-start";
/** Phones: a full-width line under the row; wide: the Sources column. */
const DETAIL_CELL = cn("col-span-2 col-start-1 row-start-2 min-w-0 pb-10 md:col-span-1 md:col-start-3 md:row-start-1 md:pb-0", NAME_INSET, "md:pl-0", "md:py-10");
const DIVIDER = "[border-top:var(--row-divider)]";
const RECORDS_DATE = "Whole credit batch";

interface SourcesTableProps {
  line: EmissionLine;
  scope: EmissionBatchScope;
  canWrite: boolean;
  model: ReturnType<typeof lineBodyModel>;
  onForm: (mode: EntryFormMode) => void;
  onDeleteEntry: (line: EmissionLine, entry: EmissionEntry) => void;
}

export function SourcesTable({ line, scope, canWrite, model, onForm, onDeleteEntry }: SourcesTableProps) {
  const { records } = model;
  const entryCount = model.values.length + model.stopped.length;
  const groupLabel = entryCount > 1 ? "Manual entries" : "Manual entry";
  return (
    <div role="table" aria-label={`Sources of ${line.displayName}`} className="flex flex-col">
      <div role="row" className={cn(TABLE_ROW, "body-small font-medium text-[var(--color-text-secondary)]")}>
        <span role="columnheader" className={cn("col-start-1 row-start-1 pb-6", NAME_INSET)}>Source</span>
        <span role="columnheader" className="hidden pb-6 md:col-start-2 md:row-start-1 md:block">Date</span>
        <span role="columnheader" className="hidden pb-6 md:col-start-3 md:row-start-1 md:block">Files and note</span>
        <span role="columnheader" className="col-start-2 row-start-1 pb-6 text-right md:col-start-4">Amount</span>
        <span role="columnheader" className="col-start-3 row-start-1 md:col-start-5"><span className="sr-only">Actions</span></span>
      </div>
      {records && (
        <div role="row" className={cn(TABLE_ROW, DIVIDER)}>
          <span role="cell" className={SOURCE_CELL}>
            <RecordsSourceLink records={records} scope={scope} className="self-start" />
            <span className="body-caption text-[var(--color-text-tertiary)] md:hidden">{RECORDS_DATE}</span>
          </span>
          <span role="cell" className={DATE_CELL}>{RECORDS_DATE}</span>
          <span role="cell" className={cn(AMOUNT_CELL, !hasRecordsFigure(records) && "text-[var(--color-text-tertiary)]")}>
            {hasRecordsFigure(records) ? formatFigure(records.figure) : MISSING_VALUE.notRecorded}
          </span>
        </div>
      )}
      {model.values.map((entry, index) => (
        <EntryRow
          key={entry.id}
          line={line}
          entry={entry}
          scope={scope}
          canWrite={canWrite}
          groupLabel={index === 0 ? groupLabel : null}
          onEdit={() => onForm({ kind: "edit", entry })}
          onDelete={() => onDeleteEntry(line, entry)}
        />
      ))}
      {model.stopped.map((entry, index) => (
        <StoppedRow
          key={entry.id}
          line={line}
          entry={entry}
          scope={scope}
          canWrite={canWrite}
          groupLabel={!model.values.length && index === 0 ? groupLabel : null}
          canEnterAgain={model.takesEntries}
          onEnterAgain={() => onForm({ kind: "again", entry })}
          onDelete={() => onDeleteEntry(line, entry)}
        />
      ))}
      {model.showTotal && (
        <div role="row" className={cn(TABLE_ROW, "[border-top:var(--hair-2)]")}>
          <span role="rowheader" className={cn(CELL_Y, NAME_INSET, "col-start-1 row-start-1 body-small font-medium md:col-start-3 md:pl-0 md:text-right")}>Total</span>
          <span role="cell" className={cn(AMOUNT_CELL, model.totalMissing ? "text-[var(--color-text-tertiary)]" : "font-medium")}>{model.totalText}</span>
        </div>
      )}
    </div>
  );
}

/** The Source cell of an entry: the group name on the first entry, the date on phones. */
function EntrySource({ groupLabel, dateText, muted }: { groupLabel: string | null; dateText: string; muted?: boolean }) {
  return (
    <span role="cell" className={SOURCE_CELL}>
      {groupLabel && (
        <span className={cn("inline-flex items-center gap-6 body-small", muted && "text-[var(--color-text-tertiary)]")}>
          <PencilSimpleIcon size={ICON} aria-hidden="true" className="shrink-0" />
          {groupLabel}
        </span>
      )}
      <span className="body-small text-[var(--color-text-secondary)] md:hidden">
        {dateText}
      </span>
    </span>
  );
}

function EntryRow({ line, entry, scope, canWrite, groupLabel, onEdit, onDelete }: {
  line: EmissionLine;
  entry: EmissionEntry;
  scope: EmissionBatchScope;
  canWrite: boolean;
  groupLabel: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const actions = useEntryActions(onEdit, onDelete);
  const dateText = entryDateText(line, entry);
  const { figures, detail } = entryAmount(entry);
  return (
    <div role="row" className={cn(TABLE_ROW, DIVIDER)}>
      <EntrySource groupLabel={groupLabel} dateText={dateText} />
      <span role="cell" className={DATE_CELL}>{dateText}</span>
      <span role="cell" className={DETAIL_CELL}>
        <EntryEvidence entry={entry} scope={scope} canWrite={canWrite} actions={actions} />
      </span>
      <span role="cell" className={AMOUNT_CELL}>
        {figures.map((figure) => <span key={figure}>{figure}</span>)}
        {/* How a mass × distance figure was made, under the figure it explains. */}
        {detail && <span className="body-caption text-[var(--color-text-tertiary)]">{detail}</span>}
      </span>
      <span role="cell" className={MENU_CELL}>
        {canWrite && <EntryMenu label={`Actions for the manual entry, ${dateText}`} items={actions.items} />}
      </span>
    </div>
  );
}

function StoppedRow({ line, entry, scope, canWrite, groupLabel, canEnterAgain, onEnterAgain, onDelete }: {
  line: EmissionLine;
  entry: EmissionEntry;
  scope: EmissionBatchScope;
  canWrite: boolean;
  groupLabel: string | null;
  canEnterAgain: boolean;
  onEnterAgain: () => void;
  onDelete: () => void;
}) {
  const { confirmEntry, confirming, error } = useStoppedEntry(line, entry, scope);
  const dateText = entryDateText(line, entry);
  const { figures } = entryAmount(entry);
  return (
    <div role="row" className={cn(TABLE_ROW, DIVIDER)}>
      <EntrySource groupLabel={groupLabel} dateText={dateText} muted />
      <span role="cell" className={cn(DATE_CELL, "text-[var(--color-text-tertiary)]")}>{dateText}</span>
      <span role="cell" className={cn(DETAIL_CELL, "flex flex-col items-start gap-8")}>
        <span className="body-caption text-[var(--st-wait)]">{stoppedEntryMessage(entry, canEnterAgain)}</span>
        {canWrite && entry.canConfirm && <Button size="small" variant="primary" busy={confirming} onClick={() => void confirmEntry()}>Confirm</Button>}
        {canWrite && !entry.canConfirm && canEnterAgain && <Button size="small" variant="primary" onClick={onEnterAgain}>Enter again</Button>}
        {error && <ServerError message={error} />}
      </span>
      <span role="cell" className={cn(AMOUNT_CELL, "text-[var(--color-text-tertiary)] line-through")}>
        {figures.map((figure) => <span key={figure}>{figure}</span>)}
      </span>
      <span role="cell" className={MENU_CELL}>
        {canWrite && <EntryMenu label={`Actions for the stopped manual entry, ${dateText}`} items={[{ label: "Delete", onSelect: onDelete, destructive: true }]} />}
      </span>
    </div>
  );
}
