/**
 * PROTOTYPE detail C3a, "Equation columns" (round 3 brief §5, recommended).
 * C3's monthly pass (KPI strip, chips, sort, pager, "Record this month" with
 * Save all, "Show done lines"), with the line figure written as an equation
 * on every row: From records + Entries = Total. The bulk grid keeps the same
 * three columns with Entries as the input. Row click opens the line panel
 * (C3c's ledger, per-entry ⋯); the row ⋯ lists the brief §2 actions;
 * Nothing to record is a one-tap icon with Undo. Below lg each row is a card
 * with C3b's stacked caption. Cells, panel and forms:
 * prototype-detail-c3a-panel.tsx.
 */
"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { DotsThreeVerticalIcon, EmptyIcon, PaperclipIcon, WarningIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms";
import { Button, DropdownMenu, Input, PageHeader, Tooltip } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  GAS_INPUTS,
  PROTOTYPE_TEMPLATE_NAME,
  deriveLines,
  entriesFor,
  openLines,
  prototypeActions,
  type EntryDraft,
  type PrototypeEntry,
  type PrototypeLine,
} from "./prototype-emissions-data";
import { NeedsSetupText, ProtoNote, ReviewBlock, YEARLY_REPORT_FILE, batchPeriod, creditBatchSheetHref, LineStateBadge, type usePrototypeEmissions } from "./prototype-emissions-shared";
import { DetailKpiStrip, DetailTopBar, LineSortSelect, LineStateChips, NoLinesMatch, useBatchDetail, type BatchDetail } from "./prototype-detail-shared";
import { compositionCaption, lineCase, nothingToRecordRefusal, recordsSource, rowMenuItems, totalAfter } from "./prototype-line-sources";
import {
  BeforeAfter,
  EntriesCell,
  LinePanel,
  Op,
  RecordsCell,
  SETUP_TEXT,
  TotalText,
  defaultEntryDate,
  hasRecordsGap,
  nothingApplies,
  parseAmount,
  type LineOps,
  type PanelView,
} from "./prototype-detail-c3a-panel";

/**
 * Open question for Kenji (amendment 5): is Add entry offered on a line whose
 * records source holds nothing (B1, B2, F)? Flip to false to send those lines
 * upstream only. This is the one gate; every surface reads it via `offered`.
 */
const OFFER_ENTRY_ON_RECORDS_GAP = true;

type Data = ReturnType<typeof usePrototypeEmissions>;
const TH = "px-12 py-10 font-medium text-left whitespace-nowrap";
const TD = "px-12 py-12 align-top";
const COLUMNS = 8;
/** Clears the floating prototype switcher so the footer and the undo bar stay clickable. */
const FOOTER_LIFT = "bottom-[64px]";
const UNDO_MS = 8000;
const MSG_NUMBER = "Enter a non-negative decimal value.";
const MSG_DATE = "Entry date cannot be before the credit batch start date.";

export const DETAIL_C3A_NAME = "Equation columns";

const offered = (line: PrototypeLine) => OFFER_ENTRY_ON_RECORDS_GAP || !hasRecordsGap(line);

/* ---------- local delete overlay (the stub store has no delete) ---------- */

function withoutEntries(data: Data, deleted: string[]): Data {
  if (!deleted.length) return data;
  return {
    ...data,
    batches: data.batches.map((view) => {
      const lines = deriveLines(view.batch, entriesFor(data.store, view.batch).filter((e) => !deleted.includes(e.id)));
      return { batch: view.batch, lines, open: openLines(lines) };
    }),
  };
}

type UndoInput = { text: string; lineId: string; kind: "nothing" } | { text: string; lineId: string; kind: "delete"; entryId: string };
type Undo = UndoInput & { id: number };

/* ---------- grid drafts ---------- */

interface Draft { nothing: boolean; a: string; b: string; date: string; file: string | null; note: string }
type Drafts = Record<string, Draft>;
interface RowErrors { a?: string; b?: string; date?: string }

const isPaired = (line: PrototypeLine) => line.def.shape === "gas" || line.def.shape === "massDistance";
const isFileOnly = (line: PrototypeLine) => line.state === "missingEvidence";
const isEditable = (line: PrototypeLine) => (line.state === "empty" && line.def.rule !== "none") || line.state === "missingEvidence";

function touched(line: PrototypeLine, d: Draft): boolean {
  if (isFileOnly(line)) return !!d.file;
  return d.nothing || !!(d.a.trim() || d.b.trim() || d.note.trim() || d.file);
}
/** The note on Nothing to record is optional (amendment 2), so it never fails a row. */
function validate(line: PrototypeLine, d: Draft, startDate: string): RowErrors {
  const errors: RowErrors = {};
  if (isFileOnly(line)) return errors;
  if (!d.nothing) {
    if (parseAmount(d.a) == null) errors.a = MSG_NUMBER;
    if (isPaired(line) && parseAmount(d.b) == null) errors.b = MSG_NUMBER;
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
/** The draft's figure in the line unit, for the live total. */
function draftAmount(line: PrototypeLine, d: Draft): number | null {
  if (d.nothing) return 0;
  const a = parseAmount(d.a);
  if (line.def.shape === "massDistance") { const b = parseAmount(d.b); return a != null && b != null ? (a * b) / 1000 : null; }
  return line.def.shape === "gas" ? null : a;
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
  return { kind: "value", date: d.date, note: d.note.trim(), files: d.file ? [d.file] : [], ...amounts };
}
const plural = (n: number) => (n === 1 ? "line" : "lines");

/* ---------- the page ---------- */

export function DetailC3A({ data, batchId }: { data: Data; batchId: string }) {
  const toast = useToast();
  const [deleted, setDeleted] = useState<string[]>([]);
  const detail = useBatchDetail(withoutEntries(data, deleted), batchId);
  const { view } = detail;
  const [panel, setPanel] = useState<PanelView | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [editing, setEditing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});

  const showUndo = (next: UndoInput) => {
    const id = Date.now();
    setUndo({ ...next, id });
    setTimeout(() => setUndo((current) => (current?.id === id ? null : current)), UNDO_MS);
  };
  const ops: LineOps = {
    offered,
    markNothing: (line) => {
      prototypeActions.addEntry(view.batch, line.def.id, { kind: "nothing", date: defaultEntryDate(view.batch), files: [], note: "" });
      showUndo({ kind: "nothing", lineId: line.def.id, text: `${line.def.name} marked Nothing to record.` });
    },
    deleteEntry: (line, entry: PrototypeEntry) => {
      setDeleted((all) => [...all, entry.id]);
      showUndo({ kind: "delete", lineId: line.def.id, entryId: entry.id, text: entry.kind === "nothing" ? `Nothing to record removed from ${line.def.name}.` : `Entry deleted from ${line.def.name}.` });
    },
    confirm: (line) => {
      prototypeActions.confirm(view.batch, line.def.id);
      toast.success(`${line.def.name} confirmed.`);
    },
    openPanel: setPanel,
    closePanel: () => setPanel(null),
  };
  const runUndo = () => {
    if (!undo) return;
    if (undo.kind === "delete") setDeleted((all) => all.filter((id) => id !== undo.entryId));
    else {
      const zero = view.lines.find((l) => l.def.id === undo.lineId)?.nothing;
      if (zero) setDeleted((all) => [...all, zero.id]);
    }
    setUndo(null);
  };
  const addNoteFromUndo = () => {
    if (!undo) return;
    const zero = view.lines.find((l) => l.def.id === undo.lineId)?.nothing;
    if (zero) setPanel({ lineId: undo.lineId, view: "form", mode: "nothing", entryId: zero.id, from: "row" });
    setUndo(null);
  };

  const blank = (): Draft => ({ nothing: false, a: "", b: "", date: view.batch.endDate, file: null, note: "" });
  const draftOf = (id: string): Draft => drafts[id] ?? blank();
  const patch = (id: string, change: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...(all[id] ?? blank()), ...change } }));
  const gridLines = view.lines.filter((line) => line.open);
  const editable = gridLines.filter(isEditable);
  const doneLines = view.lines.filter((line) => !line.open);
  const gapLines = gridLines.filter(hasRecordsGap);
  const status = editable.filter((line) => touched(line, draftOf(line.def.id))).map((line) => {
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
      const target = document.getElementById(`c3a-${firstBad.line.def.id}-${key}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center" });
    }
    const parts = [
      values ? `${values} ${values === 1 ? "entry" : "entries"}` : "",
      nothings ? `${nothings} marked Nothing to record` : "",
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
        <DetailTopBar view={view} batches={detail.data.batches} />
        <PageHeader
          title={view.batch.code}
          subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`}
          actions={editing ? null : <Button variant="primary" disabled={gridLines.length === 0} onClick={start}>Record this month</Button>}
        />
      </div>
      <DetailKpiStrip detail={detail} />

      {editing ? (
        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="body-large font-medium">{`Open lines, ${gridLines.length}`}</h2>
              <p className="body-caption text-[var(--color-text-secondary)]">Fill what you have. Lines you leave empty stay open. From records is read only here.</p>
            </div>
            <Button variant="weak" aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide done lines" : `Show done lines (${doneLines.length})`}
            </Button>
          </div>
          <div className="[border:var(--panel-border)] bg-[var(--paper)]">
            <div aria-hidden="true" className={cn(GRID_COLS, "hidden bg-[var(--sea)] px-16 py-10 body-small font-medium text-[var(--color-text-secondary)] lg:grid")}>
              <span>Line</span><span className="text-right">From records</span><Op>+</Op><span>Entries</span><Op>=</Op><span className="text-right">Total</span>
            </div>
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
                  onAgain={() => setPanel({ lineId: line.def.id, view: "form", mode: "again", from: "row" })}
                />
              ))}
            </ul>
            {showDone && (
              <>
                <p className="[border-top:var(--row-divider)] bg-[var(--sea)] px-16 py-8 body-caption font-medium text-[var(--color-text-tertiary)]">Done lines</p>
                <ul>
                  {doneLines.map((line) => (
                    <li key={line.def.id} className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-4 px-16 py-10 body-small [border-top:var(--row-divider)]">
                      <span className="min-w-0 flex-1 basis-[240px]">{line.def.name}</span>
                      <span className="min-w-0 flex-1 basis-[240px] body-caption text-[var(--color-text-secondary)]">{compositionCaption(line)}</span>
                      <TotalText line={line} className="w-[160px] text-right" />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className={cn("sticky z-10 -mx-16 flex flex-col gap-8 border-t border-[var(--color-border-primary)] bg-[var(--paper)] px-16 py-10 sm:mx-0 sm:border", FOOTER_LIFT)}>
            {gapLines.length > 0 && (
              <p className="inline-flex items-start gap-6 body-caption text-[var(--color-text-secondary)]">
                <WarningIcon size={14} weight="bold" className="mt-2 shrink-0 text-[var(--st-wait)]" aria-hidden="true" />
                {`${gapLines.length} ${plural(gapLines.length)} ${gapLines.length === 1 ? "has" : "have"} records with nothing recorded. What a run or delivery covers belongs on that record, not in an entry.`}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-8">
              <p role="status" className={cn("body-small font-medium", attempted && failing && "text-[var(--st-bad)]")}>{statusText}</p>
              <div className="flex gap-8">
                <Button variant="weak" onClick={stop}>Cancel</Button>
                <Button variant="primary" disabled={status.length === 0} onClick={saveAll}>Save all</Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ReadLedger detail={detail} ops={ops} />
      )}
      <LinePanel view={view} panel={panel} ops={ops} />
      {undo && (
        <div role="status" className={cn("fixed left-1/2 z-[var(--z-layer-popover)] flex w-[min(560px,calc(100%-32px))] -translate-x-1/2 flex-wrap items-center gap-x-12 gap-y-4 bg-[var(--paper)] px-16 py-8 [border:var(--hair)]", FOOTER_LIFT)}>
          <span className="min-w-0 flex-1 body-small">{undo.text}</span>
          {undo.kind === "nothing" && <Button size="small" variant="weak" onClick={addNoteFromUndo}>Add note</Button>}
          <Button size="small" variant="default" onClick={runUndo}>Undo</Button>
          <Button size="icon" variant="noOutline" aria-label="Dismiss" onClick={() => setUndo(null)}><XIcon size={16} weight="bold" /></Button>
        </div>
      )}
    </div>
  );
}

/* ---------- row controls: Nothing to record icon and the ⋯ menu ---------- */

function NothingIcon({ line, ops, quiet }: { line: PrototypeLine; ops: LineOps; quiet: boolean }) {
  if (!nothingApplies(line)) return <span className="inline-block w-[32px]" aria-hidden="true" />;
  const refusal = nothingToRecordRefusal(line);
  return (
    <Tooltip content={refusal ? <><span className="block font-medium">Nothing to record</span>{refusal}</> : "Nothing to record"}>
      <Button
        variant="noOutline"
        size="icon"
        aria-label="Nothing to record"
        aria-disabled={refusal ? true : undefined}
        aria-description={refusal ?? undefined}
        onClick={(event) => { event.stopPropagation(); if (!refusal) ops.markNothing(line); }}
        className={cn(
          "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
          refusal && "cursor-not-allowed opacity-40 hover:text-[var(--color-text-secondary)]",
          // Refused rows show it on hover and focus only, so done rows stay quiet.
          quiet && "opacity-0 focus-visible:opacity-40 group-hover:opacity-40 group-focus-within:opacity-40",
        )}
      >
        <EmptyIcon size={18} weight="bold" />
      </Button>
    </Tooltip>
  );
}

function RowMenu({ line, ops }: { line: PrototypeLine; ops: LineOps }) {
  const items = rowMenuItems(line).filter((item) => item.key !== "add" || offered(line));
  const missing = line.values.find((e) => !e.files.length);
  const run = (key: string) => {
    const id = line.def.id;
    if (key === "add") ops.openPanel({ lineId: id, view: "form", mode: "add", from: "row" });
    if (key === "addFile" && missing) ops.openPanel({ lineId: id, view: "form", mode: "edit", entryId: missing.id, from: "row" });
    if (key === "confirm") ops.confirm(line);
    if (key === "nothing") ops.markNothing(line);
    if (key === "description") ops.openPanel({ lineId: id, view: "ledger", description: true });
  };
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger render={<Button variant="noOutline" size="icon" aria-label={`Actions for ${line.def.name}`} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" />}>
          <DotsThreeVerticalIcon size={20} weight="bold" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="min-w-[240px]">
          {items.map((item) =>
            item.href ? (
              <DropdownMenu.Item key={item.key} render={<Link href={item.href} />}>{item.label}</DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item key={item.key} disabled={item.disabled} onClick={() => run(item.key)}>
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {item.disabled && item.reason && <span className="body-caption text-[var(--color-text-secondary)]">{item.reason}</span>}
                </span>
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

function RowControls({ line, ops }: { line: PrototypeLine; ops: LineOps }) {
  const refused = !!nothingToRecordRefusal(line);
  return (
    <div className="flex items-center justify-end gap-2">
      <NothingIcon line={line} ops={ops} quiet={refused} />
      <RowMenu line={line} ops={ops} />
    </div>
  );
}

/* ---------- read mode: the equation table (lg) and cards (below lg) ---------- */

const isFirstGapRow = (line: PrototypeLine, lines: PrototypeLine[]) => {
  const first = lines.find((l) => { const k = lineCase(l); return k === "B1" || k === "B2"; });
  return first?.def.id === line.def.id;
};

function ReadLedger({ detail, ops }: { detail: BatchDetail; ops: LineOps }) {
  const open = (line: PrototypeLine) => ops.openPanel({ lineId: line.def.id, view: "ledger" });
  const addNote = (line: PrototypeLine) => line.nothing && ops.openPanel({ lineId: line.def.id, view: "form", mode: "nothing", entryId: line.nothing.id, from: "row" });
  const note = (
    <ProtoNote>Open question: entry offered on a records gap. Add entry stays available on lines whose runs or deliveries hold nothing, with a warning in the form.</ProtoNote>
  );

  const row = (line: PrototypeLine, showGroup: boolean) => {
    const kind = lineCase(line);
    const setup = line.state === "needsSetup";
    return (
      <Fragment key={line.def.id}>
        <tr onClick={() => open(line)} className={cn("group cursor-pointer [border-top:var(--row-divider)] hover:bg-[var(--row-hover-bg-solid)]", line.open && "bg-[var(--st-wait-bg)]/40")}>
          <td className={TD}>
            <button type="button" aria-haspopup="dialog" className="min-h-24 text-left font-medium underline-offset-4 group-hover:underline">{line.def.name}</button>
            {showGroup && <span className="block body-caption text-[var(--color-text-tertiary)]">{line.def.group}</span>}
          </td>
          <td className={TD}><LineStateBadge state={line.state} /></td>
          {setup ? (
            <td colSpan={5} className={cn(TD, "text-[var(--color-text-secondary)]")}>{SETUP_TEXT}</td>
          ) : kind === "S" ? (
            <>
              <td className={cn(TD, "text-right")}><RecordsCell line={line} /></td>
              <td colSpan={4} className={cn(TD, "text-right")}><TotalText line={line} className={line.values.length ? "font-medium" : undefined} /></td>
            </>
          ) : (
            <>
              <td className={cn(TD, "text-right")}><RecordsCell line={line} /></td>
              <td className={cn(TD, "px-0")}><Op className="block">+</Op></td>
              <td className={cn(TD, "text-right")}><EntriesCell line={line} onAddNote={() => addNote(line)} /></td>
              <td className={cn(TD, "px-0")}><Op className="block">=</Op></td>
              <td className={cn(TD, "text-right")}><TotalText line={line} className="font-medium" /></td>
            </>
          )}
          <td className={cn(TD, "py-6")}><RowControls line={line} ops={ops} /></td>
        </tr>
        {isFirstGapRow(line, detail.view.lines) && (
          <tr><td colSpan={COLUMNS} className="px-12 pb-12">{note}</td></tr>
        )}
      </Fragment>
    );
  };

  const card = (line: PrototypeLine) => {
    const kind = lineCase(line);
    const setup = line.state === "needsSetup";
    const caption = setup ? SETUP_TEXT : kind === "S" ? "One entry per credit batch" : compositionCaption(line);
    const missing = line.state === "missingEvidence";
    const stopped = line.review[0];
    return (
      <li key={line.def.id} className={cn("[border-top:var(--row-divider)] first:[border-top:none]", line.open && "bg-[var(--st-wait-bg)]/40")}>
        <div onClick={() => open(line)} className="flex cursor-pointer flex-col gap-6 px-16 py-12">
          <div className="flex items-start justify-between gap-12">
            <button type="button" aria-haspopup="dialog" className="min-h-24 text-left body-small font-medium">{line.def.name}</button>
            <div className="-mt-4 -mr-6 flex shrink-0 items-start gap-2">
              {nothingApplies(line) && !nothingToRecordRefusal(line) && <NothingIcon line={line} ops={ops} quiet={false} />}
              <RowMenu line={line} ops={ops} />
            </div>
          </div>
          <span><LineStateBadge state={line.state} /></span>
          <div className="flex items-end justify-between gap-16">
            <span className="flex min-w-0 flex-col gap-2 body-caption text-[var(--color-text-secondary)]">
              <span>
                {caption}
                {line.nothing && !line.nothing.note && !line.values.length && (
                  <>{". "}<button type="button" onClick={(e) => { e.stopPropagation(); addNote(line); }} className="text-[var(--color-text-interaction-primary)] underline underline-offset-4">Add note</button></>
                )}
              </span>
              {missing && <span className="inline-flex items-center gap-4 text-[var(--st-wait)]"><WarningIcon size={12} weight="bold" aria-hidden="true" />File missing</span>}
              {stopped && <span className="text-[var(--st-wait)]"><s>{formatDate(stopped.date)}</s> entry stopped counting</span>}
            </span>
            <TotalText line={line} className="shrink-0 text-right body-large font-medium" />
          </div>
        </div>
        {isFirstGapRow(line, detail.view.lines) && <div className="px-16 pb-12">{note}</div>}
      </li>
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
          <>
            <table className="hidden w-full body-small lg:table">
              <colgroup>
                <col />
                <col className="w-[148px]" />
                <col className="w-[200px] xl:w-[232px]" />
                <col className="w-[24px]" />
                <col className="w-[168px] xl:w-[200px]" />
                <col className="w-[24px]" />
                <col className="w-[136px] xl:w-[160px]" />
                <col className="w-[80px]" />
              </colgroup>
              <thead className="bg-[var(--sea)] text-[var(--color-text-secondary)]">
                <tr>
                  <th className={TH}>Line</th>
                  <th className={TH}>State</th>
                  <th className={cn(TH, "text-right")}>From records</th>
                  <th className={cn(TH, "px-0")}><Op className="block">+</Op></th>
                  <th className={cn(TH, "text-right")}>Entries</th>
                  <th className={cn(TH, "px-0")}><Op className="block">=</Op></th>
                  <th className={cn(TH, "text-right")}>Total</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {detail.grouped
                  ? detail.groups.map((group) => (
                      <Fragment key={group.group}>
                        <tr className="border-t border-[var(--color-border-tertiary)]">
                          <th colSpan={COLUMNS} scope="colgroup" className="px-12 pt-16 pb-4 text-left body-caption font-medium text-[var(--color-text-tertiary)]">{group.group}</th>
                        </tr>
                        {group.lines.map((line) => row(line, false))}
                      </Fragment>
                    ))
                  : detail.lines.map((line) => row(line, true))}
              </tbody>
            </table>
            <ul className="lg:hidden">
              {detail.grouped
                ? detail.groups.map((group) => (
                    <Fragment key={group.group}>
                      <li className="[border-top:var(--row-divider)] first:[border-top:none] bg-[var(--sea)] px-16 py-6 body-caption font-medium text-[var(--color-text-tertiary)]">{group.group}</li>
                      {group.lines.map(card)}
                    </Fragment>
                  ))
                : detail.lines.map(card)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- edit grid row: the same three columns, Entries is the input ---------- */

const GRID_COLS = "grid-cols-[168px_152px_16px_minmax(0,1fr)_16px_208px] gap-x-12";
const GRID_COLS_LG = "lg:grid-cols-[168px_152px_16px_minmax(0,1fr)_16px_208px] lg:gap-x-12";

interface GridRowProps {
  line: PrototypeLine;
  detail: BatchDetail;
  draft: Draft;
  errors: RowErrors;
  onChange: (change: Partial<Draft>) => void;
  onAgain: () => void;
}

function GridRow({ line, detail, draft, errors, onChange, onAgain }: GridRowProps) {
  const { view } = detail;
  const { def } = line;
  const id = def.id;
  const month = new Date(`${view.batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const labels = inputLabels(line);
  const canNothing = nothingApplies(line) && !nothingToRecordRefusal(line);
  const missingEntry = line.values.find((e) => !e.files.length);
  const gap = hasRecordsGap(line);
  const source = recordsSource(line);
  const open = rowMenuItems(line).find((item) => item.key === "open");
  const amount = draftAmount(line, draft);
  const preview = totalAfter(line, amount);
  const gasAfter = def.shape === "gas" && parseAmount(draft.a) != null && parseAmount(draft.b) != null ? `${draft.a} mg/kg, ${Number(draft.b).toLocaleString("en-US")} kg` : null;

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

  let entries: React.ReactNode;
  let spanAll = false;
  if (line.state === "needsReview") {
    spanAll = true;
    entries = <ReviewBlock line={line} batch={view.batch} onEnterAgain={onAgain} />;
  } else if (line.state === "needsSetup") {
    spanAll = true;
    entries = view.batch.real ? (
      <Link href={creditBatchSheetHref(view.batch)} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">Set up in the credit batch</Link>
    ) : <NeedsSetupText />;
  } else if (line.state === "empty" && def.rule === "none") {
    entries = <span className="body-small text-[var(--color-text-tertiary)]">Takes no entries</span>;
  } else if (line.state === "missingEvidence") {
    entries = (
      <div className="flex flex-col gap-4">
        <p className="body-small text-[var(--color-text-secondary)]">{missingEntry ? `The ${formatDate(missingEntry.date)} entry has no file.` : "An entry has no file."}</p>
        {fileSlot}
      </div>
    );
  } else {
    const inputs = !offered(line) ? (
      open?.href && <Link href={open.href} className="inline-flex min-h-44 items-center body-small font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4">{open.label}</Link>
    ) : draft.nothing ? (
      <div className="w-full sm:min-w-[220px] sm:flex-1">
        <FormField id={`c3a-${id}-note`} label="Note" cue="Optional">
          <Input id={`c3a-${id}-note`} value={draft.note} onChange={(e) => onChange({ note: e.target.value })} placeholder={`For example: No staff flights in ${month}`} />
        </FormField>
      </div>
    ) : (
      labels.map(([label, unit], index) => {
        const key = index === 0 ? "a" : "b";
        return (
          <div key={label} className={cn("w-full", isPaired(line) ? "sm:w-[136px]" : "sm:w-[148px]")}>
            <FormField id={`c3a-${id}-${index}`} label={label} unit={unit} error={errors[key]}>
              <Input id={`c3a-${id}-${index}`} inputMode="decimal" value={draft[key]} onChange={(e) => onChange({ [key]: e.target.value })} />
            </FormField>
          </div>
        );
      })
    );
    entries = (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-start gap-12">
          {inputs}
          {(offered(line) || draft.nothing) && (
            <div className="w-full sm:w-[156px]">
              <FormField id={`c3a-${id}-date`} label="Date" error={errors.date}>
                <Input id={`c3a-${id}-date`} type="date" value={draft.date} min={view.batch.startDate} onChange={(e) => onChange({ date: e.target.value })} />
              </FormField>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-16">
          {!draft.nothing && offered(line) && fileSlot}
          {canNothing && (
            <button type="button" aria-pressed={draft.nothing} onClick={() => onChange({ nothing: !draft.nothing, file: null })} className="inline-flex min-h-44 items-center whitespace-nowrap body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
              {draft.nothing ? "Enter a value instead" : "Nothing to record"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const records = def.rule === "single" ? (
    <span className="body-small text-[var(--color-text-tertiary)]">One entry per credit batch</span>
  ) : <RecordsCell line={line} warn={gap} />;
  const total = def.shape === "gas"
    ? <BeforeAfter before={line.totalText} after={gasAfter} />
    : <BeforeAfter before={preview.before} after={amount == null ? null : preview.after} />;
  const hasRecords = source.kind === "records";

  return (
    <li className={cn("grid gap-y-8 px-16 py-12 [border-top:var(--row-divider)] first:border-t-0 lg:items-start lg:gap-y-0", GRID_COLS_LG)}>
      <div className="flex flex-col items-start gap-4">
        <span className="body-small font-medium">{def.name}</span>
        <span className="body-caption text-[var(--color-text-tertiary)]">{def.group}</span>
        {line.state !== "empty" && <LineStateBadge state={line.state} />}
      </div>
      {spanAll ? (
        <div className="lg:col-span-5">{entries}</div>
      ) : (
        <>
          {/* Phone: the records figure sits as a read-only line above the input. */}
          <div className={cn("flex items-baseline justify-between gap-12 body-small lg:block lg:pt-28 lg:text-right", !hasRecords && def.rule !== "single" && "max-lg:hidden")}>
            <span className="body-caption text-[var(--color-text-tertiary)] lg:hidden">From records</span>
            {records}
          </div>
          <Op className="hidden lg:block lg:pt-28">+</Op>
          <div>{entries}</div>
          <Op className="hidden lg:block lg:pt-28">=</Op>
          <div className="flex items-baseline justify-between gap-12 body-small lg:flex lg:justify-end lg:pt-24">
            <span className="body-caption text-[var(--color-text-tertiary)] lg:hidden">Total</span>
            {total}
          </div>
        </>
      )}
    </li>
  );
}
