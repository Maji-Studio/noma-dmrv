/**
 * The body of an expanded line row: From records + Manual entries = Total,
 * read as an equation, then the line comment. Records are read-only and link
 * to where they are made; each manual entry carries its own ⋯. Add and Edit
 * open the entry form panel.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Notice } from "@/components/ui";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import {
  NEEDS_SETUP_COPY,
  SINGLE_LINE_CAPTION,
  entriesFigure,
  formatFigure,
  hasRecordsFigure,
  lineRecords,
  lineTotalText,
  openSourceLabel,
  recordsHref,
  recordsText,
  stoppedEntries,
  valueEntries,
  type EmissionEntry,
  type EmissionLine,
} from "./emission-line-display";
import { ManualEntryItem, StoppedEntryItem } from "./emission-ledger-entries";
import { EmissionLineComment } from "./emission-line-comment";
import type { EntryFormMode } from "./manual-entry-form";
import { SOURCE_ICON } from "./emission-source-chips";

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
  const [showDescription, setShowDescription] = useState(false);
  const records = lineRecords(line);
  const values = valueEntries(line);
  const stopped = stoppedEntries(line);
  const single = line.entryPolicy === "single";
  const takesEntries = line.entryPolicy !== "none";
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
          canEnterAgain={takesEntries}
          onEnterAgain={() => onForm({ kind: "again", entry })}
          onDelete={() => onDeleteEntry(line, entry)}
        />
      ))}
      {!values.length && !stopped.length && <li className="body-caption text-[var(--color-text-tertiary)]">{MISSING_VALUE.none}</li>}
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
        <LedgerRow op="+" label="Manual entries" figure={takesEntries || stopped.length ? (entriesSum ? formatFigure(entriesSum) : values.length ? undefined : MISSING_VALUE.none) : undefined} muted={!values.length}>
          {/* Stopped entries stay listed with their Delete on a line that takes no new ones (a removed template line). */}
          {takesEntries || stopped.length ? entryList : <span className="body-caption text-[var(--color-text-tertiary)]">Takes no manual entries. Records fill this line.</span>}
        </LedgerRow>
        <LedgerRow op="=" label="Total" figure={lineTotalText(line)} total muted={!line.total && line.state !== "confirmedZero"} />
      </div>
    );
  }

  const reviewWithoutEntries = line.state === "needsReview" && !stopped.length;
  return (
    <div id={id} role="region" aria-label={`${line.displayName} details`} className="flex flex-col gap-20 bg-[var(--paper)] px-16 pt-4 pb-20 md:pl-24">
      {line.description && (
        <div className="flex flex-col gap-8">
          <button
            type="button"
            aria-expanded={showDescription}
            onClick={() => setShowDescription((open) => !open)}
            className="inline-flex min-h-44 items-center gap-6 self-start body-small font-medium text-[var(--color-text-interaction-primary)] underline-offset-4 hover:underline"
          >
            {showDescription ? <CaretDownIcon size={16} weight="bold" aria-hidden="true" /> : <CaretRightIcon size={16} weight="bold" aria-hidden="true" />}
            Line description
          </button>
          {showDescription && <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{line.description}</p>}
        </div>
      )}
      {reviewWithoutEntries && (
        <Notice tone="warning" action={<Link href={templatesHref} className="body-small font-medium underline underline-offset-4">Open template review</Link>}>
          {line.blocker?.message ?? "An admin reviews this line in the template review."}
        </Notice>
      )}
      {ledger}
      {line.state !== "needsSetup" && (
        <EmissionLineComment line={line} scope={scope} canWrite={canWrite} editing={editingComment} onEditingChange={onEditingComment} />
      )}
    </div>
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
