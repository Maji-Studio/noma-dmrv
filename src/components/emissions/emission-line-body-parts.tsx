/**
 * Pieces of an open line row: what the body reads off a line, the one quiet
 * action style for every in-body verb (and the row's empty Sources cell),
 * the records link that names its count, an entry's files and note, its
 * Add file panel, and the setup and review notices.
 */
"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, FileIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms/server-error";
import { Button, Notice } from "@/components/ui";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";
import { cn } from "@/lib/utils";
import { EntryFileUpload, useEntryFiles } from "./emission-entry-files";
import {
  NEEDS_SETUP_COPY,
  addEntryRefusal,
  formatFigure,
  hasRecordsFigure,
  lineRecords,
  lineTotalText,
  openSourceLabel,
  recordsHref,
  recordsSourceText,
  stoppedEntries,
  valueEntries,
  type EmissionEntry,
  type EmissionLine,
  type LineRecords,
} from "./emission-line-display";
import type { EntryMenuItem } from "./emission-ledger-entries";
import { TOUCH_TARGET } from "./emission-line-grid";
import { SOURCE_ICON } from "./emission-source-chips";

export const ICON = 14;

/** What the body reads off a line before laying it out. */
export function lineBodyModel(line: EmissionLine, canWrite: boolean) {
  const records = lineRecords(line);
  const values = valueEntries(line);
  const stopped = stoppedEntries(line);
  const hasSomething = !!records || values.length > 0 || stopped.length > 0;
  const recordsCount = hasRecordsFigure(records) ? 1 : 0;
  return {
    records,
    values,
    stopped,
    takesEntries: line.entryPolicy !== "none",
    /** No records source and no entries: the body says so in one sentence (the row's Sources cell holds Add). */
    nothingYet: !hasSomething && line.state !== "needsSetup",
    /** Add manual entry inside the body, only when the Sources cell shows chips instead of the link. */
    canAddInBody: canWrite && hasSomething && !addEntryRefusal(line),
    /** The Total repeats the one part when only one part counts, so it shows from two parts up. */
    showTotal: recordsCount + values.length > 1,
    totalText: lineTotalText(line),
    totalMissing: !line.total && line.state !== "confirmedZero",
    reviewWithoutEntries: line.state === "needsReview" && !stopped.length,
  };
}

const QUIET_ACTION = cn(
  TOUCH_TARGET,
  "inline-flex min-h-28 items-center gap-6 text-left body-small font-medium text-[var(--color-text-interaction-primary)] underline decoration-[color:var(--color-border-primary)] underline-offset-4 hover:decoration-current",
);

/** The one tertiary action style: text with a quiet underline, an optional leading icon. */
export function QuietAction({ children, icon, onClick, label, expanded, controls, className }: {
  children: ReactNode;
  icon?: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Accessible name when the visible text needs the line's name too. */
  label?: string;
  expanded?: boolean;
  controls?: string;
  className?: string;
}) {
  return (
    <button type="button" aria-label={label} aria-expanded={expanded} aria-controls={controls} onClick={onClick} className={cn(QUIET_ACTION, className)}>
      {icon}
      {children}
    </button>
  );
}

/** Add manual entry as a quiet action: the row's empty Sources cell and the body's action group. */
export function AddEntryLink({ line, onAdd, className }: { line: EmissionLine; onAdd: () => void; className?: string }) {
  return (
    <QuietAction
      label={`Add manual entry on ${line.displayName}`}
      icon={<PlusIcon size={ICON} weight="bold" aria-hidden="true" />}
      onClick={(event) => {
        event.stopPropagation();
        onAdd();
      }}
      className={className}
    >
      Add manual entry
    </QuietAction>
  );
}

/** "3 production runs" as the link to them, with the source icon; a source that holds nothing reads in warning ink. */
export function RecordsSourceLink({ records, scope, className }: { records: LineRecords; scope: EmissionBatchScope; className?: string }) {
  const SourceIcon = SOURCE_ICON[records.source];
  const gap = !hasRecordsFigure(records);
  const text = recordsSourceText(records);
  const split = text.lastIndexOf(" ") + 1;
  return (
    <Link
      href={recordsHref(records, scope)}
      aria-label={`${text}. ${openSourceLabel(records.source)}`}
      className={cn(
        "inline-flex min-h-24 items-baseline gap-6 body-small underline decoration-[color:var(--color-border-primary)] underline-offset-4 hover:decoration-current",
        gap ? "text-[var(--st-wait)]" : "text-[var(--color-text-primary)]",
        className,
      )}
    >
      <SourceIcon size={ICON} aria-hidden="true" className="shrink-0 self-center" />
      <span>
        {text.slice(0, split)}
        {/* The last word keeps the arrow, so a wrap never strands it alone. */}
        <span className="whitespace-nowrap">
          {text.slice(split)}
          <ArrowUpRightIcon size={12} weight="bold" aria-hidden="true" className="ml-4 inline text-[var(--color-text-tertiary)]" />
        </span>
      </span>
    </Link>
  );
}

/**
 * An entry's amount for a figure column: its total, with the mass × distance
 * that made it as a separate detail, or each value on its own line when the
 * entry holds a pair with no single total.
 */
export function entryAmount(entry: EmissionEntry): { figures: string[]; detail: string | null } {
  const [first] = entry.values;
  if (entry.total && entry.values.length === 1) {
    const md = first?.massDistanceDetail;
    return { figures: [formatFigure(entry.total)], detail: md ? `${formatFigure(md.mass)} × ${formatFigure(md.distance)}` : null };
  }
  return { figures: entry.values.map((value) => formatFigure({ magnitude: value.magnitude, unit: value.unit })), detail: null };
}

/** One counting entry's actions: Edit, Add file (opens the upload in place), Delete. */
export function useEntryActions(onEdit: () => void, onDelete: () => void) {
  const [addingFile, setAddingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const items: EntryMenuItem[] = [
    { label: "Edit", onSelect: onEdit },
    { label: "Add file", onSelect: () => setAddingFile(true) },
    { label: "Delete", onSelect: onDelete, destructive: true },
  ];
  return { items, addingFile, startAddFile: () => setAddingFile(true), stopAddFile: () => setAddingFile(false), uploadError, setUploadError };
}

function AddFilePanel({ entry, scope, actions }: { entry: EmissionEntry; scope: EmissionBatchScope; actions: ReturnType<typeof useEntryActions> }) {
  if (!actions.addingFile) return null;
  return (
    <div className="flex flex-col gap-8 pt-4">
      <EntryFileUpload id={`entry-file-${entry.id}`} entry={entry} scope={scope} onUploaded={actions.stopAddFile} onError={actions.setUploadError} />
      {actions.uploadError && <ServerError message={actions.uploadError} />}
      <div>
        <Button size="small" variant="weak" onClick={actions.stopAddFile}>Done</Button>
      </div>
    </div>
  );
}

/**
 * An entry's files (or File missing with Add file) and its note as one
 * caption line that wraps, then the upload panel. Until the file names load
 * the entry's own count stands in, so the slot never shows an empty bar.
 */
export function EntryEvidence({ entry, scope, canWrite, actions, className }: {
  entry: EmissionEntry;
  scope: EmissionBatchScope;
  canWrite: boolean;
  actions: ReturnType<typeof useEntryActions>;
  className?: string;
}) {
  const { files, countText } = useEntryFiles(entry);
  const missing = entry.documentCount === 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-16 gap-y-2 body-caption text-[var(--color-text-secondary)]">
        {missing ? (
          <span className="inline-flex min-h-24 items-center gap-4 text-[var(--st-wait)]">
            <WarningIcon size={ICON} weight="bold" aria-hidden="true" />
            File missing
          </span>
        ) : files ? (
          files.map((file) => (
            <a
              key={file.id}
              href={file.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-24 max-w-full min-w-0 items-center gap-4 underline-offset-4 hover:text-[var(--color-text-primary)] hover:underline"
            >
              <FileIcon size={ICON} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{file.fileName}</span>
            </a>
          ))
        ) : (
          <span className="inline-flex min-h-24 items-center gap-4 text-[var(--color-text-tertiary)]">
            <FileIcon size={ICON} aria-hidden="true" className="shrink-0" />
            {countText}
          </span>
        )}
        {missing && canWrite && !actions.addingFile && (
          <QuietAction onClick={actions.startAddFile} className="min-h-24 body-caption">Add file</QuietAction>
        )}
        {entry.note && <span className="min-w-0">{entry.note}</span>}
      </div>
      <AddFilePanel entry={entry} scope={scope} actions={actions} />
    </div>
  );
}

/** The one sentence a line with no records source and no entries collapses to. */
export function NothingYet({ line, className }: { line: EmissionLine; className?: string }) {
  const text = line.entryPolicy === "single"
    ? "No manual entry yet. One manual entry counts for the whole credit batch."
    : line.entryPolicy === "none"
      ? "No records source yet. This line takes no manual entries."
      : "No records source and no manual entries yet.";
  return <p className={cn("body-small text-[var(--color-text-tertiary)]", className)}>{text}</p>;
}

function TemplateReviewLink({ scope }: { scope: EmissionBatchScope }) {
  return (
    <Link href={certificationRemovalTemplatesHref(scope.facilityId)} className="body-small font-medium underline underline-offset-4">
      Open template review
    </Link>
  );
}

export function SetupNotice({ scope }: { scope: EmissionBatchScope }) {
  return <Notice tone="info" action={<TemplateReviewLink scope={scope} />}>{NEEDS_SETUP_COPY}</Notice>;
}

export function ReviewNotice({ line, scope }: { line: EmissionLine; scope: EmissionBatchScope }) {
  return (
    <Notice tone="warning" action={<TemplateReviewLink scope={scope} />}>
      {line.blocker?.message ?? "An admin reviews this line in the template review."}
    </Notice>
  );
}
