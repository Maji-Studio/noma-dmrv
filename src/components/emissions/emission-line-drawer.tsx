/**
 * The ledger drawer of one line: From records + Manual entries = Total, read
 * as an equation. Records are read-only and link to where they are made;
 * each manual entry carries its own ⋯. The footer offers Add manual entry and
 * Nothing to record. Add and Edit swap the ledger for the entry form in the
 * same drawer.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, CaretDownIcon, CaretRightIcon, MinusCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, Notice } from "@/components/ui";
import {
  SlideOverPanelBody,
  SlideOverPanelContent,
  SlideOverPanelDescription,
  SlideOverPanelFooter,
  SlideOverPanelHeader,
  SlideOverPanelRoot,
  SlideOverPanelTitle,
} from "@/components/ui/slide-over-panel";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import { EmissionLineBadge } from "./emission-line-badge";
import {
  NEEDS_SETUP_COPY,
  SINGLE_LINE_CAPTION,
  addEntryRefusal,
  entriesFigure,
  formatFigure,
  groupLabel,
  nothingRefusalText,
  hasRecordsFigure,
  lineRecords,
  lineTotalText,
  nothingApplies,
  nothingEntry,
  nothingRefusal,
  openSourceLabel,
  recordsHref,
  recordsText,
  stoppedEntries,
  valueEntries,
  type EmissionBatch,
  type EmissionEntry,
  type EmissionLine,
} from "./emission-line-display";
import { ManualEntryItem, NothingEntryItem, StoppedEntryItem } from "./emission-ledger-entries";
import { ManualEntryForm, type EntryFormMode } from "./manual-entry-form";
import { SOURCE_ICON } from "./emission-source-chips";

export type DrawerView = { kind: "ledger"; focusNote?: boolean } | { kind: "form"; mode: EntryFormMode };

interface EmissionLineDrawerProps {
  line: EmissionLine | null;
  view: DrawerView;
  batch: EmissionBatch;
  scope: EmissionBatchScope;
  today: string;
  /** False while manual entries are switched off: the ledger is read-only. */
  canWrite: boolean;
  onViewChange: (view: DrawerView) => void;
  onClose: () => void;
  onNothing: (line: EmissionLine) => void;
  onDeleteEntry: (line: EmissionLine, entry: EmissionEntry) => void;
  /** Called after a form save; `warning` when the entry saved but its file did not. */
  onSaved: (line: EmissionLine, warning?: string) => void;
}

export function EmissionLineDrawer({ line, view, batch, scope, today, canWrite, onViewChange, onClose, onNothing, onDeleteEntry, onSaved }: EmissionLineDrawerProps) {
  return (
    <SlideOverPanelRoot open={!!line} onOpenChange={(open) => !open && onClose()}>
      <SlideOverPanelContent size="default">
        {line &&
          (view.kind === "form" ? (
            <ManualEntryForm
              key={`${line.componentId}-${view.mode.kind}-${view.mode.kind === "add" ? "" : view.mode.entry.id}`}
              line={line}
              batch={batch}
              scope={scope}
              today={today}
              mode={view.mode}
              onCancel={() => onViewChange({ kind: "ledger" })}
              onSaved={({ warning }) => {
                onViewChange({ kind: "ledger" });
                onSaved(line, warning);
              }}
            />
          ) : (
            <LedgerView
              key={line.componentId}
              line={line}
              batch={batch}
              scope={scope}
              focusNote={!!view.focusNote}
              canWrite={canWrite}
              onForm={(mode) => onViewChange({ kind: "form", mode })}
              onNothing={onNothing}
              onDeleteEntry={onDeleteEntry}
            />
          ))}
      </SlideOverPanelContent>
    </SlideOverPanelRoot>
  );
}

/** One ledger row: the operator in a gutter, a label and its detail, the figure on the right. */
function LedgerRow({ op, label, figure, children, total, muted }: { op?: string; label: string; figure?: string; children?: ReactNode; total?: boolean; muted?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[24px_minmax(0,1fr)] gap-x-8", total && "pt-12 [border-top:var(--hair)]")}>
      <span aria-hidden="true" className="body-large leading-none text-[var(--color-text-tertiary)]">{op}</span>
      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-16">
          <span className={cn("body-small font-medium", muted && "text-[var(--color-text-secondary)]")}>{label}</span>
          {figure != null && (
            <span className={cn("text-right tabular-nums", total ? "body-large font-medium" : "body-small font-medium", muted && "text-[var(--color-text-tertiary)]")}>
              {figure}
            </span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

interface LedgerViewProps {
  line: EmissionLine;
  batch: EmissionBatch;
  scope: EmissionBatchScope;
  focusNote: boolean;
  canWrite: boolean;
  onForm: (mode: EntryFormMode) => void;
  onNothing: (line: EmissionLine) => void;
  onDeleteEntry: (line: EmissionLine, entry: EmissionEntry) => void;
}

function LedgerView({ line, batch, scope, focusNote, canWrite, onForm, onNothing, onDeleteEntry }: LedgerViewProps) {
  const [showDescription, setShowDescription] = useState(false);
  const records = lineRecords(line);
  const values = valueEntries(line);
  const stopped = stoppedEntries(line);
  const zero = nothingEntry(line);
  const single = line.entryPolicy === "single";
  const takesEntries = line.entryPolicy !== "none";
  const addRefusal = addEntryRefusal(line);
  const refusal = nothingRefusal(line);
  const templatesHref = certificationRemovalTemplatesHref(scope.facilityId);
  const entriesSum = entriesFigure(line);

  const entryList = (
    <ul className="flex flex-col" aria-label="Manual entries">
      {values.map((entry) => (
        <ManualEntryItem
          key={entry.id}
          line={line}
          entry={entry}
          scope={scope}
          canWrite={canWrite}
          onEdit={() => onForm({ kind: "edit", entry })}
          onDelete={() => onDeleteEntry(line, entry)}
        />
      ))}
      {stopped.map((entry) => (
        <StoppedEntryItem
          key={entry.id}
          line={line}
          entry={entry}
          scope={scope}
          canWrite={canWrite}
          onEnterAgain={() => onForm({ kind: "again", entry })}
          onDelete={() => onDeleteEntry(line, entry)}
        />
      ))}
      {zero && !values.length && (
        <NothingEntryItem key={zero.id} line={line} entry={zero} scope={scope} startEditing={focusNote} onUndo={() => onDeleteEntry(line, zero)} />
      )}
      {!values.length && !stopped.length && !zero && <li className="body-caption text-[var(--color-text-tertiary)]">{MISSING_VALUE.none}</li>}
    </ul>
  );

  let ledger: ReactNode;
  if (line.state === "needsSetup") {
    ledger = (
      <Notice tone="info" action={<Link href={templatesHref} className="body-small font-medium underline underline-offset-4">Open template review</Link>}>
        {NEEDS_SETUP_COPY}
      </Notice>
    );
  } else if (single) {
    ledger = (
      <LedgerRow label="Manual entry" figure={values.length ? undefined : MISSING_VALUE.notRecorded} muted={!values.length}>
        <span className="body-caption text-[var(--color-text-tertiary)]">{SINGLE_LINE_CAPTION}</span>
        {entryList}
      </LedgerRow>
    );
  } else {
    ledger = (
      <div className="flex flex-col gap-16">
        <LedgerRow label="From records" figure={hasRecordsFigure(records) ? formatFigure(records.figure) : undefined} muted={!hasRecordsFigure(records)}>
          {records ? (
            <RecordsDetail line={line} scope={scope} />
          ) : (
            <span className="body-caption text-[var(--color-text-tertiary)]">No records source. Nothing on another page feeds this line.</span>
          )}
        </LedgerRow>
        <LedgerRow op="+" label="Manual entries" figure={takesEntries ? (entriesSum ? formatFigure(entriesSum) : values.length ? undefined : MISSING_VALUE.none) : undefined} muted={!values.length}>
          {takesEntries ? entryList : <span className="body-caption text-[var(--color-text-tertiary)]">Takes no manual entries. Records fill this line.</span>}
        </LedgerRow>
        <LedgerRow op="=" label="Total" figure={lineTotalText(line)} total muted={!line.total && line.state !== "confirmedZero"} />
      </div>
    );
  }

  const singleEntry = single ? values[0] : undefined;
  const reviewWithoutEntries = line.state === "needsReview" && !stopped.length;
  return (
    <>
      <SlideOverPanelHeader>
        <div className="flex min-w-0 flex-col gap-2">
          <SlideOverPanelTitle>{line.displayName}</SlideOverPanelTitle>
          <SlideOverPanelDescription>{`${groupLabel(line)}, ${batch.code}`}</SlideOverPanelDescription>
        </div>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <div className="flex flex-col gap-20">
          <div className="flex flex-wrap items-center justify-between gap-12">
            <EmissionLineBadge state={line.state} />
            {line.description && (
              <button
                type="button"
                aria-expanded={showDescription}
                onClick={() => setShowDescription((open) => !open)}
                className="inline-flex min-h-44 items-center gap-6 body-small font-medium text-[var(--color-text-interaction-primary)] underline-offset-4 hover:underline"
              >
                {showDescription ? <CaretDownIcon size={16} weight="bold" aria-hidden="true" /> : <CaretRightIcon size={16} weight="bold" aria-hidden="true" />}
                Line description
              </button>
            )}
          </div>
          {showDescription && line.description && (
            <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{line.description}</p>
          )}
          {reviewWithoutEntries && (
            <Notice tone="warning" action={<Link href={templatesHref} className="body-small font-medium underline underline-offset-4">Open template review</Link>}>
              {line.blocker?.message ?? "An admin reviews this line in the template review."}
            </Notice>
          )}
          {ledger}
        </div>
      </SlideOverPanelBody>
      {canWrite && line.state !== "needsSetup" && takesEntries && (
        <SlideOverPanelFooter className="flex-wrap justify-between">
          <div className="flex min-w-0 flex-1 flex-col items-start">
            {nothingApplies(line) &&
              (refusal ? (
                <>
                  <Button variant="noOutline" disabled aria-describedby="nothing-refusal" className="gap-6 px-0">
                    <MinusCircleIcon size={20} aria-hidden="true" />
                    Nothing to record
                  </Button>
                  <span id="nothing-refusal" className="body-caption text-[var(--color-text-tertiary)]">{nothingRefusalText(refusal)}</span>
                </>
              ) : (
                <Button variant="noOutline" onClick={() => onNothing(line)} className="gap-6 px-0">
                  <MinusCircleIcon size={20} aria-hidden="true" />
                  Nothing to record
                </Button>
              ))}
          </div>
          {singleEntry ? (
            <Button variant="primary" onClick={() => onForm({ kind: "edit", entry: singleEntry })}>Edit manual entry</Button>
          ) : (
            !addRefusal && <Button variant="primary" onClick={() => onForm({ kind: "add" })}>Add manual entry</Button>
          )}
        </SlideOverPanelFooter>
      )}
    </>
  );
}

function RecordsDetail({ line, scope }: { line: EmissionLine; scope: EmissionBatchScope }) {
  const records = lineRecords(line);
  if (!records) return null;
  const SourceIcon = SOURCE_ICON[records.source];
  const gap = !hasRecordsFigure(records);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-4">
      <span className={cn("inline-flex items-center gap-6 body-small", gap ? "text-[var(--st-wait)]" : "text-[var(--color-text-secondary)]")}>
        <SourceIcon size={16} aria-hidden="true" />
        {recordsText(records)}
      </span>
      <Link
        href={recordsHref(records, scope)}
        className="inline-flex min-h-44 items-center gap-4 body-small font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4"
      >
        {openSourceLabel(records.source)}
        <ArrowUpRightIcon size={14} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}
