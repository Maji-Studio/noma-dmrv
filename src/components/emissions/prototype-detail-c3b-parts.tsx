/**
 * PROTOTYPE detail C3b helpers: the add form (the line's equation, top to
 * bottom: From records, fixed; Entry, on top; Total after save, two blocks and
 * an arrow) and the "Record this month" grid. The page, the read rows and the
 * inline ledger live in prototype-detail-c3b.tsx.
 *
 * Colour key shared with the read view: records are plum ink, entries are
 * violet, a records gap is a dashed warning outline.
 */
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon, FileIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormFileUpload, FormTextarea, type DeferredFileEntry } from "@/components/forms";
import { Button, Input, Notice } from "@/components/ui";
import {
  SlideOverPanelBody,
  SlideOverPanelContent,
  SlideOverPanelDescription,
  SlideOverPanelFooter,
  SlideOverPanelHeader,
  SlideOverPanelRoot,
  SlideOverPanelTitle,
} from "@/components/ui/slide-over-panel";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  GAS_INPUTS,
  entryText,
  formatFigure,
  formatNumber,
  prototypeActions,
  type EntryDraft,
  type PrototypeBatch,
  type PrototypeEntry,
  type PrototypeLine,
} from "./prototype-emissions-data";
import { DisclosureButton, LineStateBadge, ReviewBlock, YEARLY_REPORT_FILE } from "./prototype-emissions-shared";
import { entryGuard, lineCase, recordsSource, recordsText } from "./prototype-line-sources";
import type { BatchDetail } from "./prototype-detail-shared";

const KG_PER_TONNE = 1000;
const TODAY = new Date().toISOString().slice(0, 10);
const MSG_NUMBER = "Enter a non-negative decimal value.";
const MSG_DATE_START = "Entry date cannot be before the credit batch start date.";
const MSG_DATE_FUTURE = "Entry date cannot be in the future at this facility.";
/** Clears the floating prototype switcher so the footer stays clickable. */
const FOOTER_LIFT = "bottom-[64px]";
const OPEN_LABEL = { "production runs": "Open production runs", "transport legs": "Open transport legs", deliveries: "Open deliveries", applications: "Open applications" } as const;

const isNumber = (raw: string) => /^\d+(?:\.\d+)?$/.test(raw.trim());
const toNumber = (raw: string) => (isNumber(raw) ? Number(raw) : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The figure a draft adds in the line unit, or null while it is incomplete. */
export function draftFigure(line: PrototypeLine, a: string, b: string): number | null {
  if (line.def.shape === "gas") return null;
  const first = toNumber(a);
  if (line.def.shape === "massDistance") {
    const second = toNumber(b);
    return first != null && second != null ? (first * second) / KG_PER_TONNE : null;
  }
  return first;
}

/** An EntryDraft from a stored entry, with changes. */
export function entryDraft(entry: PrototypeEntry, change: Partial<EntryDraft> = {}): EntryDraft {
  const { kind, date, value, mass, distance, concentration, massFlow, files, note } = entry;
  return { kind, date, value, mass, distance, concentration, massFlow, files, note, ...change };
}

/* ---------- small shared pieces ---------- */

/** The upstream page for a line's records, read only. Stops the row click. */
export function RecordsLink({ line, children, className }: { line: PrototypeLine; children?: ReactNode; className?: string }) {
  const source = recordsSource(line);
  if (source.kind !== "records") return null;
  return (
    <Link
      href={source.href}
      onClick={(event) => event.stopPropagation()}
      className={cn("inline-flex items-center gap-4 underline decoration-[var(--color-border-primary)] underline-offset-4 hover:decoration-current", className)}
    >
      {children ?? OPEN_LABEL[source.label]}
      <ArrowUpRightIcon size={12} weight="bold" aria-hidden="true" />
    </Link>
  );
}

export function openLabel(line: PrototypeLine): string | null {
  const source = recordsSource(line);
  return source.kind === "records" ? OPEN_LABEL[source.label] : null;
}

/** Before and after as two blocks with an arrow, never a sentence. */
export function BeforeAfter({ before, after, beforeLabel = "Now", afterLabel = "After save", compact = false }: { before: string; after: string; beforeLabel?: string; afterLabel?: string; compact?: boolean }) {
  const block = (label: string, value: string, strong: boolean) => (
    <div className={cn("flex min-w-0 flex-col gap-2 border px-12", compact ? "py-6" : "py-10", strong ? "border-[var(--color-interaction)] bg-[var(--color-background-white)]" : "border-[var(--color-border-secondary)]")}>
      <span className="body-caption text-[var(--color-text-secondary)]">{label}</span>
      <span className={cn("tabular-nums", compact ? "body-small" : "body-medium", strong ? "font-medium" : "text-[var(--color-text-secondary)]")}>{value}</span>
    </div>
  );
  return (
    <div role="group" aria-label={`${beforeLabel} ${before}, ${afterLabel.toLowerCase()} ${after}`} className="flex flex-wrap items-center gap-8">
      {block(beforeLabel, before, false)}
      <ArrowRightIcon size={18} aria-hidden="true" className="shrink-0 text-[var(--color-icon-secondary)]" />
      {block(afterLabel, after, true)}
    </div>
  );
}

/* ---------- the entry sheet ---------- */

export type C3bMode = "add" | "edit" | "again";
export interface C3bTarget { lineId: string; mode: C3bMode; entryId?: string }

export function useC3bSheet() {
  const [target, setTarget] = useState<C3bTarget | null>(null);
  const [open, setOpen] = useState(false);
  return { target, open, show: (next: C3bTarget) => { setTarget(next); setOpen(true); }, close: () => setOpen(false) };
}
export type C3bSheet = ReturnType<typeof useC3bSheet>;

const TITLES: Record<C3bMode, string> = { add: "Add entry", edit: "Edit entry", again: "Enter again" };

export function C3bEntrySheet({ sheet, batch, lines }: { sheet: C3bSheet; batch: PrototypeBatch; lines: PrototypeLine[] }) {
  const line = lines.find((l) => l.def.id === sheet.target?.lineId);
  return (
    <SlideOverPanelRoot open={sheet.open && !!line} onOpenChange={(next) => !next && sheet.close()}>
      <SlideOverPanelContent size="default">
        {line && sheet.target && (
          <EntryForm key={`${line.def.id}-${sheet.target.mode}-${sheet.target.entryId ?? ""}`} target={sheet.target} batch={batch} line={line} onDone={sheet.close} />
        )}
      </SlideOverPanelContent>
    </SlideOverPanelRoot>
  );
}

interface FormValues { a: string; b: string; date: string; note: string; files: DeferredFileEntry[]; existingFiles: string[] }
type FormErrors = Partial<Record<"a" | "b" | "date", string>>;

function seedValues(line: PrototypeLine, seed: PrototypeEntry | undefined, defaultDate: string, keepFiles: boolean): FormValues {
  const gas = line.def.shape === "gas";
  const pair = line.def.shape === "massDistance";
  return {
    a: (gas ? seed?.concentration : pair ? seed?.mass : seed?.value)?.toString() ?? "",
    b: (gas ? seed?.massFlow : pair ? seed?.distance : undefined)?.toString() ?? "",
    date: seed?.date ?? defaultDate,
    note: seed?.note ?? "",
    files: [],
    existingFiles: keepFiles ? seed?.files ?? [] : [],
  };
}

function EntryForm({ target, batch, line, onDone }: { target: C3bTarget; batch: PrototypeBatch; line: PrototypeLine; onDone: () => void }) {
  const toast = useToast();
  const { def } = line;
  const editing = target.mode === "edit" ? line.entries.find((e) => e.id === target.entryId) : undefined;
  const again = target.mode === "again" ? line.review[0] : undefined;
  const defaultDate = batch.endDate < TODAY ? batch.endDate : TODAY;
  const [values, setValues] = useState<FormValues>(() => seedValues(line, editing ?? again, defaultDate, !!editing));
  const [errors, setErrors] = useState<FormErrors>({});
  const [showDescription, setShowDescription] = useState(false);
  const set = (key: "a" | "b" | "date" | "note") => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));

  const gas = def.shape === "gas";
  const pair = def.shape === "massDistance";
  const source = recordsSource(line);
  const hasRecords = source.kind === "records";
  const gap = hasRecords && source.value == null;
  const replacesZero = !editing && line.nothing && !line.values.length ? line.nothing : null;
  const figure = draftFigure(line, values.a, values.b);

  const save = () => {
    const next: FormErrors = {};
    if (!isNumber(values.a)) next.a = MSG_NUMBER;
    if ((gas || pair) && !isNumber(values.b)) next.b = MSG_NUMBER;
    if (!values.date) next.date = "Enter a valid entry date.";
    else if (values.date < batch.startDate) next.date = MSG_DATE_START;
    else if (values.date > TODAY) next.date = MSG_DATE_FUTURE;
    setErrors(next);
    if (Object.keys(next).length) return;
    const amounts = gas ? { concentration: Number(values.a), massFlow: Number(values.b) } : pair ? { mass: Number(values.a), distance: Number(values.b) } : { value: Number(values.a) };
    const draft: EntryDraft = { kind: "value", date: values.date, note: values.note.trim(), files: [...values.existingFiles, ...values.files.map((f) => f.file.name)], ...amounts };
    if (editing) prototypeActions.updateEntry(batch, editing.id, draft);
    else prototypeActions.addEntry(batch, def.id, draft, again ? line.review.map((e) => e.id) : replacesZero ? [replacesZero.id] : []);
    toast.success(replacesZero ? `Entry saved on ${def.name}. It replaces Nothing to record.` : `Entry saved on ${def.name}.`);
    onDone();
  };

  const fileCount = values.existingFiles.length + values.files.length;
  const amountFields = gas ? (
    GAS_INPUTS.map((input, index) => (
      <FormField key={input.key} id={`c3b-entry-${index}`} label={input.label} unit={input.unit} error={errors[index === 0 ? "a" : "b"]} aside={input.key === "massFlow" ? `Dry feedstock ${formatNumber(batch.dryFeedstockT)} t` : undefined}>
        <Input id={`c3b-entry-${index}`} inputMode="decimal" value={index === 0 ? values.a : values.b} onChange={set(index === 0 ? "a" : "b")} autoFocus={index === 0} />
      </FormField>
    ))
  ) : pair ? (
    <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
      <FormField id="c3b-entry-0" label="Mass" unit="kg" error={errors.a}>
        <Input id="c3b-entry-0" inputMode="decimal" value={values.a} onChange={set("a")} autoFocus />
      </FormField>
      <FormField id="c3b-entry-1" label="Distance" unit="km" error={errors.b} cue={figure != null ? `This entry: ${formatFigure(figure, def.unit)}` : undefined}>
        <Input id="c3b-entry-1" inputMode="decimal" value={values.b} onChange={set("b")} />
      </FormField>
    </div>
  ) : (
    <FormField id="c3b-entry-0" label={def.inputLabel} unit={def.unit} error={errors.a}>
      <Input id="c3b-entry-0" inputMode="decimal" value={values.a} onChange={set("a")} autoFocus />
    </FormField>
  );

  return (
    <>
      <SlideOverPanelHeader>
        <SlideOverPanelTitle>{TITLES[target.mode]}</SlideOverPanelTitle>
        <SlideOverPanelDescription>{`${def.name}, ${def.group}`}</SlideOverPanelDescription>
      </SlideOverPanelHeader>
      <SlideOverPanelBody>
        <div className="flex flex-col gap-24">
          <div className="flex flex-col gap-6">
            <DisclosureButton open={showDescription} onToggle={() => setShowDescription((v) => !v)}>Line description</DisclosureButton>
            {showDescription && <p className="body-small whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>}
          </div>

          <section aria-labelledby="c3b-form-entry" className={cn("flex flex-col gap-20", hasRecords && "border-l-2 border-[var(--clr-purple)] pl-16")}>
            <div className="flex items-baseline justify-between gap-12">
              <h3 id="c3b-form-entry" className="body-small font-medium">Entry</h3>
              {gap && <span className="body-caption text-[var(--color-text-tertiary)]">On top of nothing from records</span>}
            </div>
            {replacesZero && <Notice tone="warning">{`This replaces Nothing to record on ${def.name}.`}</Notice>}
            {again && <p className="body-small text-[var(--color-text-secondary)]">{`Replaces ${entryText(def, again)} from ${formatDate(again.date)}, which stopped counting after a template change.`}</p>}
            {amountFields}
            {gas && <p className="-mt-8 body-caption text-[var(--color-text-secondary)]">{`Mass flow for this credit batch = ${formatNumber(batch.dryFeedstockT)} t dry feedstock × (36,792 t / 17,520 t).`}</p>}
            <FormField id="c3b-entry-date" label="Entry date" error={errors.date}>
              <Input id="c3b-entry-date" type="date" value={values.date} min={batch.startDate} max={TODAY} onChange={set("date")} />
            </FormField>
            <FormField id="c3b-entry-file" label="File" certifyRequired hint={def.yearlyReport ? "The evidence for this line is the yearly emissions test report." : undefined}>
              <div className="flex flex-col gap-8">
                {values.existingFiles.length > 0 && (
                  <ul className="flex flex-col gap-4">
                    {values.existingFiles.map((name) => (
                      <li key={name} className="inline-flex items-center gap-6 body-small"><FileIcon size={16} aria-hidden="true" />{name}</li>
                    ))}
                  </ul>
                )}
                <FormFileUpload
                  id="c3b-entry-file"
                  deferred
                  deferredFiles={values.files}
                  onDeferredAdd={(files) => setValues((v) => ({ ...v, files: [...v.files, ...files.map((file) => ({ key: `${file.name}-${file.size}-${v.files.length}`, file }))] }))}
                  onDeferredRemove={(key) => setValues((v) => ({ ...v, files: v.files.filter((f) => f.key !== key) }))}
                />
                {def.yearlyReport && !values.existingFiles.includes(YEARLY_REPORT_FILE) && (
                  <div>
                    <Button size="small" variant="weak" onClick={() => setValues((v) => ({ ...v, existingFiles: [...v.existingFiles, YEARLY_REPORT_FILE] }))}>{`Use ${YEARLY_REPORT_FILE}`}</Button>
                  </div>
                )}
                {fileCount === 0 && !def.yearlyReport && <p className="body-caption text-[var(--color-text-tertiary)]">You can save without a file. The line then reads File missing.</p>}
              </div>
            </FormField>
            <FormField id="c3b-entry-note" label="Note">
              <FormTextarea id="c3b-entry-note" value={values.note} onChange={set("note")} />
            </FormField>
          </section>

        </div>
      </SlideOverPanelBody>
      <SlideOverPanelFooter>
        <Button variant="weak" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={save}>Save entry</Button>
      </SlideOverPanelFooter>
    </>
  );
}

/* ---------- Record this month ---------- */

interface Draft { nothing: boolean; a: string; b: string; date: string; file: string | null; note: string }
type Drafts = Record<string, Draft>;
interface RowErrors { a?: string; b?: string; date?: string }

const isPaired = (line: PrototypeLine) => line.def.shape === "gas" || line.def.shape === "massDistance";
const isFileOnly = (line: PrototypeLine) => line.state === "missingEvidence";
const isEditable = (line: PrototypeLine, offerOnGap: boolean) => {
  if (line.state === "missingEvidence") return true;
  if (line.state !== "empty" || line.def.rule === "none") return false;
  const kind = lineCase(line);
  return offerOnGap || (kind !== "B1" && kind !== "B2");
};
function touched(line: PrototypeLine, d: Draft): boolean {
  if (isFileOnly(line)) return !!d.file;
  return d.nothing || !!(d.a.trim() || d.b.trim() || d.note.trim() || d.file);
}
function validate(line: PrototypeLine, d: Draft, startDate: string): RowErrors {
  const errors: RowErrors = {};
  if (isFileOnly(line) || d.nothing) return errors;
  if (!isNumber(d.a)) errors.a = MSG_NUMBER;
  if (isPaired(line) && !isNumber(d.b)) errors.b = MSG_NUMBER;
  if (d.date < startDate) errors.date = MSG_DATE_START;
  return errors;
}
function toDraft(line: PrototypeLine, d: Draft): EntryDraft | null {
  const { def } = line;
  if (isFileOnly(line)) {
    const entry = line.values.find((e) => !e.files.length);
    return entry && d.file ? entryDraft(entry, { files: [d.file] }) : null;
  }
  if (d.nothing) return { kind: "nothing", date: d.date, files: [], note: d.note.trim() };
  const amounts = def.shape === "gas" ? { concentration: Number(d.a), massFlow: Number(d.b) } : def.shape === "massDistance" ? { mass: Number(d.a), distance: Number(d.b) } : { value: Number(d.a) };
  return { kind: "value", date: d.date, note: "", files: d.file ? [d.file] : [], ...amounts };
}
function inputLabels(line: PrototypeLine): string[][] {
  if (line.def.shape === "gas") return GAS_INPUTS.map((i) => [i.label, i.unit]);
  if (line.def.shape === "massDistance") return [["Mass", "kg"], ["Distance", "km"]];
  return [[line.def.inputLabel, line.def.unit]];
}
const lines = (n: number) => (n === 1 ? "line" : "lines");

export function MonthGrid({ detail, offerOnGap, onClose, onEnterAgain }: { detail: BatchDetail; offerOnGap: boolean; onClose: () => void; onEnterAgain: (lineId: string) => void }) {
  const toast = useToast();
  const { view } = detail;
  const [showDone, setShowDone] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const blank = (): Draft => ({ nothing: false, a: "", b: "", date: view.batch.endDate < TODAY ? view.batch.endDate : TODAY, file: null, note: "" });
  const draftOf = (id: string): Draft => drafts[id] ?? blank();
  const patch = (id: string, change: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...(all[id] ?? blank()), ...change } }));

  const gridLines = view.lines.filter((line) => line.open);
  const editable = gridLines.filter((line) => isEditable(line, offerOnGap));
  const doneLines = view.lines.filter((line) => !line.open);
  const status = editable.filter((line) => touched(line, draftOf(line.def.id))).map((line) => {
    const d = draftOf(line.def.id);
    const errors = validate(line, d, view.batch.startDate);
    return { line, d, errors, ok: Object.keys(errors).length === 0 };
  });
  const ready = status.filter((s) => s.ok).length;
  const missingFile = status.filter((s) => s.ok && !isFileOnly(s.line) && !s.d.nothing && !s.d.file).length;
  const failing = status.filter((s) => !s.ok).length;
  const gaps = gridLines.filter((line) => ["B1", "B2"].includes(lineCase(line))).length;

  const saveAll = () => {
    setAttempted(true);
    let values = 0;
    let nothings = 0;
    let files = 0;
    const left: Drafts = { ...drafts };
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
      delete left[s.line.def.id];
    }
    setDrafts(left);
    const firstBad = status.find((s) => !s.ok);
    if (firstBad) {
      const key = firstBad.errors.a ? "0" : firstBad.errors.b ? "1" : "date";
      const target = document.getElementById(`c3b-${firstBad.line.def.id}-${key}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center" });
    }
    const parts = [
      values ? plural(values, "entry", "entries") : "",
      nothings ? `${nothings} marked nothing to record` : "",
      files ? `${plural(files, "file", "files")} added` : "",
    ].filter(Boolean);
    if (parts.length) toast.success(`Saved ${parts.join(", ")}.${failing ? ` ${failing} ${lines(failing)} still ${failing === 1 ? "needs" : "need"} fixing.` : ""}`);
    if (!failing) onClose();
  };

  const statusText = [ready ? `${ready} ${lines(ready)} ready` : "No lines ready yet", missingFile ? `${missingFile} missing a file` : "", attempted && failing ? `${failing} to fix` : ""].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="body-large font-medium">{`Open lines, ${gridLines.length}`}</h2>
          <p className="body-caption text-[var(--color-text-secondary)]">Fill what you have. Lines you leave empty stay open.</p>
        </div>
        <Button variant="weak" aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>{showDone ? "Hide done lines" : `Show done lines (${doneLines.length})`}</Button>
      </div>
      <div className="[border:var(--panel-border)] bg-[var(--paper)]">
        {gridLines.length === 0 && <p className="p-16 body-small text-[var(--color-text-secondary)]">Nothing is open. Every line is done.</p>}
        <ul>
          {gridLines.map((line) => (
            <GridRow
              key={line.def.id}
              line={line}
              detail={detail}
              offerOnGap={offerOnGap}
              onEnterAgain={() => onEnterAgain(line.def.id)}
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
        <div className="flex flex-col gap-2">
          <p role="status" className={cn("body-small font-medium", attempted && failing && "text-[var(--st-bad)]")}>{statusText}</p>
          {gaps > 0 && <p className="body-caption text-[var(--color-text-secondary)]">{`${gaps} ${lines(gaps)} ${gaps === 1 ? "has" : "have"} a records source with nothing recorded. Fix it on the source page when you can.`}</p>}
        </div>
        <div className="flex gap-8">
          <Button variant="weak" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={status.length === 0} onClick={saveAll}>Save all</Button>
        </div>
      </div>
    </div>
  );
}

interface GridRowProps { line: PrototypeLine; detail: BatchDetail; offerOnGap: boolean; onEnterAgain: () => void; draft: Draft; errors: RowErrors; onChange: (change: Partial<Draft>) => void }

function GridRow({ line, detail, offerOnGap, onEnterAgain, draft, errors, onChange }: GridRowProps) {
  const { view } = detail;
  const { def } = line;
  const id = def.id;
  const kind = lineCase(line);
  const gap = kind === "B1" || kind === "B2" || kind === "F";
  const canNothing = line.state === "empty" && def.rule !== "none";
  const missingEntry = line.values.find((e) => !e.files.length);

  // Read only, above the input: what the entry lands on top of.
  const recordsCaption = recordsSource(line).kind === "records" && def.rule === "additive" ? (
    <div className={cn("flex flex-col gap-2 border-l-2 pl-8 body-caption", gap ? "border-dashed border-[var(--st-wait)]" : "border-[var(--clr-dark-purple-40)]")}>
      <span className="text-[var(--color-text-secondary)]">
        {gap ? <RecordsLink line={line}>{recordsText(line)}</RecordsLink> : <>{"On top of "}<RecordsLink line={line}>{recordsText(line)}</RecordsLink></>}
      </span>
      {gap && <span className="text-[var(--color-text-secondary)]">{entryGuard(line)}</span>}
    </div>
  ) : null;

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
        <button type="button" onClick={() => onChange({ file: YEARLY_REPORT_FILE })} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">{`Use ${YEARLY_REPORT_FILE}`}</button>
      )}
    </div>
  );

  let body: ReactNode;
  if (line.state === "needsReview") {
    body = <ReviewBlock line={line} batch={view.batch} onEnterAgain={onEnterAgain} />;
  } else if (line.state === "needsSetup") {
    body = <p className="body-small text-[var(--color-text-secondary)]">noma cannot fill this template line yet. An admin sets it up in the template review.</p>;
  } else if (line.state === "empty" && def.rule === "none") {
    body = <p className="body-small text-[var(--color-text-secondary)]">{`Calculated from ${recordsText(line)}. Nothing to enter here.`}</p>;
  } else if (line.state === "missingEvidence") {
    body = (
      <div className="flex flex-col gap-4">
        <p className="body-small text-[var(--color-text-secondary)]">{missingEntry ? `The ${formatDate(missingEntry.date)} entry (${entryText(def, missingEntry)}) has no file.` : "An entry has no file."}</p>
        {fileSlot}
      </div>
    );
  } else if (gap && !offerOnGap) {
    body = (
      <div className="flex flex-col gap-8">
        {recordsCaption}
        {canNothing && (
          <div>
            <Button size="small" variant="weak" aria-pressed={draft.nothing} onClick={() => onChange({ nothing: !draft.nothing })}>{draft.nothing ? "Undo nothing to record" : "Nothing to record"}</Button>
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {recordsCaption}
        <div className="flex flex-wrap items-start gap-12">
          {draft.nothing ? (
            <div className="w-full sm:min-w-[260px] sm:flex-1">
              <FormField id={`c3b-${id}-note`} label="Note" cue="Optional. It stays in noma.">
                <Input id={`c3b-${id}-note`} value={draft.note} onChange={(e) => onChange({ note: e.target.value })} />
              </FormField>
            </div>
          ) : (
            inputLabels(line).map(([label, unit], index) => {
              const key = index === 0 ? "a" : "b";
              return (
                <div key={label} className="w-full sm:w-[220px]">
                  <FormField id={`c3b-${id}-${index}`} label={label} unit={unit} error={errors[key]}>
                    <Input id={`c3b-${id}-${index}`} inputMode="decimal" value={draft[key]} onChange={(e) => onChange({ [key]: e.target.value })} />
                  </FormField>
                </div>
              );
            })
          )}
          <div className="w-full sm:w-[168px]">
            <FormField id={`c3b-${id}-date`} label="Date" error={errors.date}>
              <Input id={`c3b-${id}-date`} type="date" value={draft.date} min={view.batch.startDate} onChange={(e) => onChange({ date: e.target.value })} />
            </FormField>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-16">
          {!draft.nothing && fileSlot}
          {canNothing && (
            <button type="button" aria-pressed={draft.nothing} onClick={() => onChange({ nothing: !draft.nothing, file: null })} className="inline-flex min-h-44 items-center whitespace-nowrap body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
              {draft.nothing ? "Enter a value instead" : "Nothing to record"}
            </button>
          )}
        </div>
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
