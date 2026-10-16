/**
 * One open line in "Record this month": its read-only source chips, then the
 * inputs for its shape, Attach file and Nothing to record. A File missing
 * line only takes the file; Needs review and Needs setup lines say what to do.
 */
"use client";

import Link from "next/link";
import { MinusCircleIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms/form-field";
import { ServerError } from "@/components/forms/server-error";
import { Button, Input } from "@/components/ui";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";
import { formatDayString } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { EmissionLineBadge } from "./emission-line-badge";
import {
  ENTRY_FILE_ACCEPT,
  addEntryRefusal,
  draftMassDistanceFigure,
  entryFields,
  groupLabel,
  nothingApplies,
  nothingRefusal,
  stoppedEntries,
  valueEntries,
  type EmissionLine,
} from "./emission-line-display";
import { SourceChips } from "./emission-source-chips";

/** Label row (24px) and its gap (6px) above a field, so chips line up with the inputs. */
const LABEL_ROW_OFFSET = "sm:mt-[30px]";

export interface RowDraft {
  values: Record<string, string>;
  date: string;
  note: string;
  nothing: boolean;
  file: File | null;
}

export type RowKind = "value" | "fileOnly" | "review" | "setup" | "none";

/** What the grid lets the operator do on an open line. */
export function rowKind(line: EmissionLine): RowKind {
  if (line.state === "needsSetup") return "setup";
  if (line.state === "needsReview") return "review";
  if (line.state === "missingEvidence") return "fileOnly";
  if (line.state === "empty" && (!addEntryRefusal(line) || canMarkNothing(line))) return "value";
  return "none";
}

export function canMarkNothing(line: EmissionLine): boolean {
  return nothingApplies(line) && !nothingRefusal(line);
}

/** The value entry a File missing line attaches its file to. */
export function entryMissingFile(line: EmissionLine) {
  return valueEntries(line).find((entry) => !entry.hasEvidence) ?? null;
}

interface RecordMonthRowProps {
  line: EmissionLine;
  scope: EmissionBatchScope;
  draft: RowDraft;
  errors: Record<string, string>;
  serverError: string | null;
  today: string;
  startDate: string;
  onChange: (change: Partial<RowDraft>) => void;
  onConfirm: (line: EmissionLine) => void;
  onEnterAgain: (line: EmissionLine) => void;
  confirming: boolean;
}

export function RecordMonthRow({ line, scope, draft, errors, serverError, today, startDate, onChange, onConfirm, onEnterAgain, confirming }: RecordMonthRowProps) {
  const kind = rowKind(line);
  const idPrefix = `month-${line.componentId}`;
  const chips = <SourceChips line={line} ids={scope} interactive={false} quietText={false} />;
  const fileSlot = (
    <span className="inline-flex flex-wrap items-center gap-4">
      <label className="inline-flex min-h-44 cursor-pointer items-center gap-6 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small focus-within:border-[var(--color-interaction)]">
        <PaperclipIcon size={16} weight="bold" aria-hidden="true" />
        <span className="max-w-[200px] truncate">{draft.file?.name ?? "Attach file"}</span>
        <input
          type="file"
          accept={ENTRY_FILE_ACCEPT}
          aria-label={`File for ${line.displayName}`}
          className="sr-only"
          onChange={(event) => onChange({ file: event.target.files?.[0] ?? null })}
        />
      </label>
      {draft.file && (
        <Button size="icon" variant="noOutline" aria-label={`Remove the file from ${line.displayName}`} className="size-44" onClick={() => onChange({ file: null })}>
          <XIcon size={16} weight="bold" aria-hidden="true" />
        </Button>
      )}
    </span>
  );

  let body;
  if (kind === "setup") {
    body = (
      <Link href={certificationRemovalTemplatesHref(scope.facilityId)} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
        An admin sets this line up in the template review
      </Link>
    );
  } else if (kind === "review") {
    const stopped = stoppedEntries(line)[0];
    body = stopped ? (
      <div className="flex flex-col gap-8">
        <p className="body-small text-[var(--color-text-secondary)]">
          {`The ${formatDayString(stopped.occurredOn)} manual entry stopped counting after a template change.`}
        </p>
        <div className="flex flex-wrap gap-8">
          {stopped.canConfirm ? (
            <Button size="small" variant="primary" busy={confirming} onClick={() => onConfirm(line)}>Confirm</Button>
          ) : (
            <Button size="small" variant="primary" onClick={() => onEnterAgain(line)}>Enter again</Button>
          )}
        </div>
      </div>
    ) : (
      <Link href={certificationRemovalTemplatesHref(scope.facilityId)} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
        An admin reviews this line in the template review
      </Link>
    );
  } else if (kind === "fileOnly") {
    const entry = entryMissingFile(line);
    body = (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center gap-8">{chips}</div>
        <p className="body-small text-[var(--color-text-secondary)]">
          {entry ? `The ${formatDayString(entry.occurredOn)} manual entry has no file.` : "A manual entry has no file."}
        </p>
        <div>{fileSlot}</div>
      </div>
    );
  } else if (kind === "value") {
    const takesValues = !addEntryRefusal(line);
    const single = line.entryPolicy === "single";
    const computed = draftMassDistanceFigure(line, draft.values);
    const fields = entryFields(line);
    body = (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-start gap-x-12 gap-y-8">
          {lineHasChips(line) && (
            <span className={cn("flex min-h-[40px] items-center gap-8", (takesValues || draft.nothing) && LABEL_ROW_OFFSET)}>
              {chips}
              {takesValues && !draft.nothing && <span aria-hidden="true" className="body-large text-[var(--color-text-tertiary)]">+</span>}
            </span>
          )}
          {draft.nothing ? (
            <div className="w-full sm:min-w-[260px] sm:flex-1">
              <FormField id={`${idPrefix}-note`} label="Note" cue="Optional">
                <Input id={`${idPrefix}-note`} value={draft.note} onChange={(event) => onChange({ note: event.target.value })} />
              </FormField>
            </div>
          ) : (
            takesValues &&
            fields.map((field) => (
              <div key={field.key} className="w-full sm:w-[200px]">
                <FormField
                  id={`${idPrefix}-${field.key}`}
                  label={field.label}
                  unit={field.unit}
                  error={errors[field.key]}
                  cue={field.part === "distance" && computed ? `This entry: ${computed}` : undefined}
                >
                  <Input
                    id={`${idPrefix}-${field.key}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.values[field.key] ?? ""}
                    onChange={(event) => onChange({ values: { ...draft.values, [field.key]: event.target.value } })}
                  />
                </FormField>
              </div>
            ))
          )}
          {!single && (takesValues || draft.nothing) && (
            <div className="w-full sm:w-[168px]">
              <FormField id={`${idPrefix}-date`} label="Date" error={errors.date}>
                <Input id={`${idPrefix}-date`} type="date" value={draft.date} min={startDate} max={today} onChange={(event) => onChange({ date: event.target.value })} />
              </FormField>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-16">
          {takesValues && !draft.nothing && fileSlot}
          {canMarkNothing(line) && (
            <button
              type="button"
              aria-pressed={draft.nothing}
              onClick={() => onChange({ nothing: !draft.nothing, file: null })}
              className="inline-flex min-h-44 items-center gap-6 whitespace-nowrap body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4"
            >
              <MinusCircleIcon size={16} aria-hidden="true" />
              {draft.nothing ? "Enter a value instead" : "Nothing to record"}
            </button>
          )}
        </div>
        {single && <p className="body-caption text-[var(--color-text-tertiary)]">Counts for the whole credit batch. No date.</p>}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center gap-8">{chips}</div>
        <p className="body-caption text-[var(--color-text-tertiary)]">Takes no manual entries. Records fill this line.</p>
      </div>
    );
  }

  return (
    <li className="grid gap-12 px-16 py-12 [border-top:var(--row-divider)] first:[border-top:none] lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-24">
      <div className="flex flex-col items-start gap-4">
        <span className="body-small font-medium">{line.displayName}</span>
        <span className="body-caption text-[var(--color-text-tertiary)]">{groupLabel(line)}</span>
        {line.state !== "empty" && <EmissionLineBadge state={line.state} />}
      </div>
      <div className="flex min-w-0 flex-col gap-8">
        {body}
        {serverError && <ServerError message={serverError} />}
      </div>
    </li>
  );
}

function lineHasChips(line: EmissionLine): boolean {
  return !!line.records || line.entries.length > 0;
}
