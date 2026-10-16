/**
 * PROTOTYPE detail C3, "Monthly pass": the default view is a short read-only
 * ledger (KPI strip, chips, compact table, pager). "Record this month" turns
 * the page into an edit grid with one row per OPEN line, a sticky footer that
 * counts what is ready, and one Save all that validates every row inline.
 * Done lines hide behind "Show done lines". Built on the shared detail API in
 * prototype-detail-shared.tsx. Saves go through prototypeActions so one pass
 * ends in one summary toast instead of one toast per line.
 */
"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms";
import { Button, Input, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { GAS_INPUTS, PROTOTYPE_TEMPLATE_NAME, prototypeActions, type EntryDraft, type PrototypeLine } from "./prototype-emissions-data";
import {
  EntrySheet,
  LineDetails,
  LineStateBadge,
  NeedsSetupText,
  ReviewBlock,
  YEARLY_REPORT_FILE,
  batchPeriod,
  creditBatchSheetHref,
  type usePrototypeEmissions,
} from "./prototype-emissions-shared";
import {
  DetailKpiStrip,
  DetailTopBar,
  LineSortSelect,
  LineStateChips,
  NoLinesMatch,
  lastEntryDate,
  useBatchDetail,
  type BatchDetail,
} from "./prototype-detail-shared";

type Data = ReturnType<typeof usePrototypeEmissions>;
const TH = "px-16 py-10 font-medium text-left whitespace-nowrap";
const TD = "px-16 py-12";
const COLUMNS = 4;
/** Clears the floating prototype switcher so the footer stays clickable. */
const FOOTER_LIFT = "bottom-[64px]";
const MSG_NUMBER = "Enter a non-negative decimal value.";
const MSG_NOTE = "Enter a note that says why there is nothing to record.";
const MSG_DATE = "Entry date cannot be before the credit batch start date.";

export const DETAIL_C3_NAME = "Monthly pass";

/* ---------- drafts ---------- */

interface Draft {
  nothing: boolean;
  a: string;
  b: string;
  date: string;
  file: string | null;
  note: string;
}
type Drafts = Record<string, Draft>;
interface RowErrors { a?: string; b?: string; note?: string; date?: string }

const isNumber = (raw: string) => /^\d+(?:\.\d+)?$/.test(raw.trim());
const isPaired = (line: PrototypeLine) => line.def.shape === "gas" || line.def.shape === "massDistance";
const isFileOnly = (line: PrototypeLine) => line.state === "missingEvidence";
/** Open lines the grid can take input for (review and setup have their own row). */
const isEditable = (line: PrototypeLine) => (line.state === "empty" && line.def.rule !== "none") || line.state === "missingEvidence";

function touched(line: PrototypeLine, d: Draft): boolean {
  if (isFileOnly(line)) return !!d.file;
  return d.nothing || !!(d.a.trim() || d.b.trim() || d.note.trim() || d.file);
}

function validate(line: PrototypeLine, d: Draft, startDate: string): RowErrors {
  const errors: RowErrors = {};
  if (isFileOnly(line)) return errors;
  if (d.nothing) {
    if (!d.note.trim()) errors.note = MSG_NOTE;
  } else {
    if (!isNumber(d.a)) errors.a = MSG_NUMBER;
    if (isPaired(line) && !isNumber(d.b)) errors.b = MSG_NUMBER;
  }
  if (d.date < startDate) errors.date = MSG_DATE;
  return errors;
}

function inputLabels(line: PrototypeLine): string[][] {
  const { def } = line;
  if (def.shape === "gas") return GAS_INPUTS.map((i) => [i.label, i.unit]);
  if (def.shape === "massDistance") return [["Mass", "kg"], ["Distance", "km"]];
  return [[def.inputLabel, def.unit]];
}

function toDraft(line: PrototypeLine, d: Draft): EntryDraft | null {
  const { def } = line;
  if (isFileOnly(line)) {
    const entry = line.values.find((e) => !e.files.length);
    if (!entry || !d.file) return null;
    return { kind: entry.kind, date: entry.date, value: entry.value, mass: entry.mass, distance: entry.distance, concentration: entry.concentration, massFlow: entry.massFlow, note: entry.note, files: [d.file] };
  }
  if (d.nothing) return { kind: "nothing", date: d.date, files: [], note: d.note.trim() };
  const amounts =
    def.shape === "gas" ? { concentration: Number(d.a), massFlow: Number(d.b) }
    : def.shape === "massDistance" ? { mass: Number(d.a), distance: Number(d.b) }
    : { value: Number(d.a) };
  return { kind: "value", date: d.date, note: "", files: d.file ? [d.file] : [], ...amounts };
}

const plural = (n: number) => (n === 1 ? "line" : "lines");

/* ---------- the page ---------- */

export function DetailC3({ data, batchId }: { data: Data; batchId: string }) {
  const detail = useBatchDetail(data, batchId);
  const toast = useToast();
  const { view } = detail;
  const defaultDate = view.batch.endDate;
  const [editing, setEditing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const blank = (): Draft => ({ nothing: false, a: "", b: "", date: defaultDate, file: null, note: "" });
  const draftOf = (id: string): Draft => drafts[id] ?? blank();
  const patch = (id: string, change: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...(all[id] ?? blank()), ...change } }));

  const gridLines = view.lines.filter((line) => line.open);
  const editable = gridLines.filter(isEditable);
  const doneLines = view.lines.filter((line) => !line.open);
  const touchedLines = editable.filter((line) => touched(line, draftOf(line.def.id)));
  const status = touchedLines.map((line) => {
    const d = draftOf(line.def.id);
    const errors = validate(line, d, view.batch.startDate);
    return { line, d, errors, ok: Object.keys(errors).length === 0 };
  });
  const ready = status.filter((s) => s.ok).length;
  const missingFile = status.filter((s) => s.ok && !isFileOnly(s.line) && !s.d.nothing && !s.d.file).length;
  const failing = status.filter((s) => !s.ok).length;

  const start = () => { setDrafts({}); setAttempted(false); setShowDone(false); setEditing(true); };
  const stop = () => { setEditing(false); setAttempted(false); setDrafts({}); };

  const saveAll = () => {
    setAttempted(true);
    let values = 0;
    let nothings = 0;
    let files = 0;
    const done: Drafts = { ...drafts };
    for (const s of status) {
      if (!s.ok) continue;
      const entry = toDraft(s.line, s.d);
      if (!entry) continue;
      if (isFileOnly(s.line)) {
        const target = s.line.values.find((e) => !e.files.length);
        if (target) prototypeActions.updateEntry(view.batch, target.id, entry);
        files += 1;
      } else {
        prototypeActions.addEntry(view.batch, s.line.def.id, entry);
        if (entry.kind === "nothing") nothings += 1; else values += 1;
      }
      delete done[s.line.def.id];
    }
    setDrafts(done);
    const firstBad = status.find((s) => !s.ok);
    if (firstBad) {
      const key = firstBad.errors.note ? "note" : firstBad.errors.a ? "0" : firstBad.errors.b ? "1" : "date";
      const target = document.getElementById(`c3-${firstBad.line.def.id}-${key}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center" });
    }
    const parts = [
      values ? `${values} ${values === 1 ? "entry" : "entries"}` : "",
      nothings ? `${nothings} marked nothing to record` : "",
      files ? `${files} ${files === 1 ? "file" : "files"} added` : "",
    ].filter(Boolean);
    if (parts.length) toast.success(`Saved ${parts.join(", ")}.${failing ? ` ${failing} ${plural(failing)} still ${failing === 1 ? "needs" : "need"} fixing.` : ""}`);
    if (!failing) stop();
  };

  const statusText = [
    ready ? `${ready} ${plural(ready)} ready` : "No lines ready yet",
    missingFile ? `${missingFile} missing a file` : "",
    attempted && failing ? `${failing} to fix` : "",
  ].filter(Boolean).join(", ");

  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        <DetailTopBar view={view} batches={data.batches} />
        <PageHeader
          title={view.batch.code}
          subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`}
          actions={
            editing ? null : (
              <Button variant="primary" disabled={gridLines.length === 0} onClick={start}>Record this month</Button>
            )
          }
        />
      </div>
      <DetailKpiStrip detail={detail} />

      {editing ? (
        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="body-large font-medium">{`Open lines, ${gridLines.length}`}</h2>
              <p className="body-caption text-[var(--color-text-secondary)]">Fill what you have. Lines you leave empty stay open.</p>
            </div>
            <Button variant="weak" aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide done lines" : `Show done lines (${doneLines.length})`}
            </Button>
          </div>
          <div className="[border:var(--panel-border)] bg-[var(--paper)]">
            {gridLines.length === 0 && <p className="p-16 body-small text-[var(--color-text-secondary)]">Nothing is open. Every line is done.</p>}
            <ul>
              {gridLines.map((line) => (
                <GridRow
                  key={line.def.id}
                  line={line}
                  detail={detail}
                  draft={draftOf(line.def.id)}
                  errors={attempted && touched(line, draftOf(line.def.id)) ? validate(line, draftOf(line.def.id), view.batch.startDate) : {}}
                  onChange={(change) => patch(line.def.id, change)}
                />
              ))}
            </ul>
            {showDone && (
              <>
                <p className="[border-top:var(--row-divider)] bg-[var(--sea)] px-16 py-8 body-caption font-medium text-[var(--color-text-tertiary)]">Done lines</p>
                <ul>
                  {doneLines.map((line) => (
                    <li key={line.def.id} className="flex flex-wrap items-center justify-between gap-x-12 gap-y-4 px-16 py-10 body-small [border-top:var(--row-divider)]">
                      <span className="min-w-0 flex-1 basis-[240px]">{line.def.name}</span>
                      <LineStateBadge state={line.state} />
                      <span className="w-[160px] text-right tabular-nums text-[var(--color-text-secondary)]">{line.totalText}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className={cn("sticky z-10 -mx-16 flex flex-wrap items-center justify-between gap-x-16 gap-y-8 border-t border-[var(--color-border-primary)] bg-[var(--paper)] px-16 py-10 sm:mx-0 sm:border", FOOTER_LIFT)}>
            <p role="status" className={cn("body-small font-medium", attempted && failing && "text-[var(--st-bad)]")}>{statusText}</p>
            <div className="flex gap-8">
              <Button variant="weak" onClick={stop}>Cancel</Button>
              <Button variant="primary" disabled={touchedLines.length === 0} onClick={saveAll}>Save all</Button>
            </div>
          </div>
        </div>
      ) : (
        <ReadLedger detail={detail} expanded={expanded} onToggle={(id) => setExpanded(expanded === id ? null : id)} />
      )}
      <EntrySheet sheet={detail.sheet} batches={data.batches} />
    </div>
  );
}

/* ---------- read mode ---------- */

function ReadLedger({ detail, expanded, onToggle }: { detail: BatchDetail; expanded: string | null; onToggle: (id: string) => void }) {
  const row = (line: PrototypeLine, showGroup: boolean) => {
    const last = lastEntryDate(line);
    return (
      <Fragment key={line.def.id}>
        <tr className={cn("[border-top:var(--row-divider)] align-top", line.open && "bg-[var(--st-wait-bg)]/40")}>
          <td className={TD}>
            <button type="button" aria-expanded={expanded === line.def.id} onClick={() => onToggle(line.def.id)} className="min-h-24 text-left hover:underline underline-offset-4">
              {line.def.name}
            </button>
            {showGroup && <span className="block body-caption text-[var(--color-text-tertiary)]">{line.def.group}</span>}
            <span className="mt-6 block md:hidden"><LineStateBadge state={line.state} /></span>
          </td>
          <td className={cn(TD, "hidden md:table-cell")}><LineStateBadge state={line.state} /></td>
          <td className={cn(TD, "text-right tabular-nums", !line.values.length && !line.auto && !line.nothing && "text-[var(--color-text-tertiary)]")}>
            {line.def.shape === "gas" && line.values.length ? (
              <>
                <span className="block whitespace-nowrap">{`${line.values[0].concentration} mg/kg`}</span>
                <span className="block whitespace-nowrap">{`${(line.values[0].massFlow ?? 0).toLocaleString("en-US")} kg`}</span>
              </>
            ) : line.state === "needsReview" ? "" : line.totalText}
          </td>
          <td className={cn(TD, "hidden whitespace-nowrap text-[var(--color-text-secondary)] lg:table-cell")}>{last ? formatDate(last) : "None"}</td>
        </tr>
        {expanded === line.def.id && (
          <tr className="bg-[var(--sea)]"><td colSpan={COLUMNS} className="px-16 py-16"><LineDetails line={line} /></td></tr>
        )}
      </Fragment>
    );
  };
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <LineStateChips detail={detail} />
        <LineSortSelect detail={detail} />
      </div>
      <div className="[border:var(--panel-border)] bg-[var(--paper)]">
        {detail.lines.length === 0 ? (
          <div className="p-16"><NoLinesMatch detail={detail} /></div>
        ) : (
          <table className="w-full body-small">
            <thead className="bg-[var(--sea)] text-[var(--color-text-secondary)]">
              <tr>
                <th className={TH}>Line</th>
                <th className={cn(TH, "hidden w-[148px] md:table-cell")}>State</th>
                <th className={cn(TH, "w-[140px] text-right md:w-[184px]")}>Total</th>
                <th className={cn(TH, "hidden w-[128px] lg:table-cell")}>Last entry</th>
              </tr>
            </thead>
            <tbody>
              {detail.grouped
                ? detail.groups.map((group) => (
                    <Fragment key={group.group}>
                      <tr className="border-t border-[var(--color-border-tertiary)]">
                        <th colSpan={COLUMNS} scope="colgroup" className="px-16 pt-16 pb-4 text-left body-caption font-medium text-[var(--color-text-tertiary)]">{group.group}</th>
                      </tr>
                      {group.lines.map((line) => row(line, false))}
                    </Fragment>
                  ))
                : detail.lines.map((line) => row(line, true))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- edit grid row ---------- */

interface GridRowProps {
  line: PrototypeLine;
  detail: BatchDetail;
  draft: Draft;
  errors: RowErrors;
  onChange: (change: Partial<Draft>) => void;
}

function GridRow({ line, detail, draft, errors, onChange }: GridRowProps) {
  const { view, actions } = detail;
  const { def } = line;
  const id = def.id;
  const month = new Date(`${view.batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const labels = inputLabels(line);
  const canNothing = line.state === "empty" && def.rule !== "none";
  const missingEntry = line.values.find((e) => !e.files.length);
  const caption =
    def.rule === "additive" && line.total != null && !draft.nothing
      ? `Adds to ${line.totalText}${def.recordsLabel ? ` from ${def.recordsLabel.toLowerCase()}` : ""}`
      : null;

  const fileSlot = (
    <div className="flex flex-wrap items-center gap-x-12">
      <span className="inline-flex items-center gap-4">
        <label className="inline-flex min-h-44 cursor-pointer items-center gap-6 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small focus-within:border-[var(--color-interaction)]">
          <PaperclipIcon size={16} weight="bold" aria-hidden="true" />
          <span className="max-w-[200px] truncate">{draft.file ?? "Attach file"}</span>
          <input type="file" aria-label={`File for ${def.name}`} className="sr-only" onChange={(e) => onChange({ file: e.target.files?.[0]?.name ?? null })} />
        </label>
        {draft.file && (
          <button type="button" aria-label={`Remove file from ${def.name}`} onClick={() => onChange({ file: null })} className="inline-flex min-h-44 min-w-44 items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
            <XIcon size={16} weight="bold" aria-hidden="true" />
          </button>
        )}
      </span>
      {def.yearlyReport && draft.file !== YEARLY_REPORT_FILE && (
        <button type="button" onClick={() => onChange({ file: YEARLY_REPORT_FILE })} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
          {`Use ${YEARLY_REPORT_FILE}`}
        </button>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (line.state === "needsReview") {
    body = <ReviewBlock line={line} batch={view.batch} onEnterAgain={() => actions.openSheet(id, "again")} />;
  } else if (line.state === "needsSetup") {
    body = view.batch.real ? (
      <Link href={creditBatchSheetHref(view.batch)} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">Set up in the credit batch</Link>
    ) : <NeedsSetupText />;
  } else if (line.state === "empty" && def.rule === "none") {
    body = <p className="body-small text-[var(--color-text-secondary)]">{`Calculated from ${(def.recordsLabel ?? "records").toLowerCase()}. Nothing to enter here.`}</p>;
  } else if (line.state === "missingEvidence") {
    body = (
      <div className="flex flex-col gap-4">
        <p className="body-small text-[var(--color-text-secondary)]">
          {missingEntry ? `The ${formatDate(missingEntry.date)} entry has no file.` : "An entry has no file."}
        </p>
        {fileSlot}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-start gap-12">
          {draft.nothing ? (
            <div className="w-full sm:min-w-[260px] sm:flex-1">
              <FormField id={`c3-${id}-note`} label="Note" required error={errors.note}>
                <Input id={`c3-${id}-note`} value={draft.note} onChange={(e) => onChange({ note: e.target.value })} placeholder={`For example: No staff flights in ${month}`} />
              </FormField>
            </div>
          ) : (
            labels.map(([label, unit], index) => {
              const key = index === 0 ? "a" : "b";
              return (
                <div key={label} className="w-full sm:w-[220px]">
                  <FormField id={`c3-${id}-${index}`} label={label} unit={unit} error={errors[key]}>
                    <Input id={`c3-${id}-${index}`} inputMode="decimal" value={draft[key]} onChange={(e) => onChange({ [key]: e.target.value })} />
                  </FormField>
                </div>
              );
            })
          )}
          <div className="w-full sm:w-[168px]">
            <FormField id={`c3-${id}-date`} label="Date" error={errors.date}>
              <Input id={`c3-${id}-date`} type="date" value={draft.date} min={view.batch.startDate} onChange={(e) => onChange({ date: e.target.value })} />
            </FormField>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-16">
          {!draft.nothing && fileSlot}
          {canNothing && (
            <button
              type="button"
              aria-pressed={draft.nothing}
              onClick={() => onChange({ nothing: !draft.nothing, file: null })}
              className="inline-flex min-h-44 items-center whitespace-nowrap body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4"
            >
              {draft.nothing ? "Enter a value instead" : "Nothing to record"}
            </button>
          )}
        </div>
        {caption && <p className="body-caption text-[var(--color-text-tertiary)]">{caption}</p>}
      </div>
    );
  }

  return (
    <li className="grid gap-12 px-16 py-12 [border-top:var(--row-divider)] first:border-t-0 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-24">
      <div className="flex flex-col items-start gap-4">
        <span className="body-small font-medium">{def.name}</span>
        <span className="body-caption text-[var(--color-text-tertiary)]">{def.group}</span>
        {line.state !== "empty" && <LineStateBadge state={line.state} />}
      </div>
      {body}
    </li>
  );
}
