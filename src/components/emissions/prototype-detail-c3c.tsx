/**
 * PROTOTYPE detail C3c, "Source chips and a ledger drawer" (round 3 brief §5).
 *
 * C3's monthly pass (KPI strip, chips, sort, pager, "Record this month" with
 * Save all, "Show done lines"), with a Sources column instead of figures per
 * origin: a records chip per origin (wash, links upstream), an entries chip
 * (outline, opens the drawer at the entries) and a Nothing to record chip.
 * The whole row opens the ledger drawer (From records + Entries = Total);
 * Add entry swaps the ledger for the form in the same drawer.
 *
 * Read rows are a list, not a table, so the whole row can be one click target
 * while the name is the keyboard target and the chips, the Nothing to record
 * icon and the ⋯ menu stay separate controls.
 */
"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon, DotsThreeVerticalIcon, MinusCircleIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField } from "@/components/forms";
import { Button, DropdownMenu, Input, Notice, PageHeader, Tooltip } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { GAS_INPUTS, PROTOTYPE_TEMPLATE_NAME, prototypeActions, type EntryDraft, type PrototypeEntry, type PrototypeLine } from "./prototype-emissions-data";
import {
  EntrySheet,
  LineStateBadge,
  NeedsSetupText,
  ProtoNote,
  ReviewBlock,
  YEARLY_REPORT_FILE,
  batchPeriod,
  creditBatchSheetHref,
  type usePrototypeEmissions,
} from "./prototype-emissions-shared";
import { DetailKpiStrip, DetailTopBar, LineSortSelect, LineStateChips, NoLinesMatch, useBatchDetail, type BatchDetail } from "./prototype-detail-shared";
import { entryGuard, lineCase, nothingToRecordRefusal, recordsSource, rowMenuItems, totalAfter } from "./prototype-line-sources";
import {
  LedgerDrawer,
  SourceChips,
  defaultEntryDate,
  hasRecordsGap,
  hiddenEntries,
  nothingApplies,
  useC3cData,
  type DrawerMode,
} from "./prototype-detail-c3c-ledger";

/**
 * Open question for Kenji: is Add entry offered on a line whose records
 * source holds nothing (cases B1, B2, F)? Flip to false to send the operator
 * upstream only. Gates the row menu, the drawer footer and the bulk grid.
 */
const OFFER_ENTRY_ON_RECORDS_GAP = true;

type Data = ReturnType<typeof usePrototypeEmissions>;
/** Clears the floating prototype switcher so the footer stays clickable. */
const FOOTER_LIFT = "bottom-[64px]";
const UNDO_MS = 10000;
const MSG_NUMBER = "Enter a non-negative decimal value.";
const MSG_DATE = "Entry date cannot be before the credit batch start date.";
const KG_PER_TONNE = 1000;

export const DETAIL_C3C_NAME = "Source chips";

/** Read rows: Line | State | Sources | Total | actions. Phones stack the same cells into a card. */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1.25fr)_148px_minmax(0,1fr)_168px_88px] md:items-center md:gap-x-16";

const isGapCase = (line: PrototypeLine) => { const k = lineCase(line); return k === "B1" || k === "B2" || k === "F"; };
/** Add entry is offered: not on R, not twice on a single line, and on a records gap only when the flag says so. */
function canAddEntry(line: PrototypeLine): boolean {
  if (line.state === "needsSetup" || line.def.rule === "none") return false;
  if (line.def.rule === "single" && line.values.length) return false;
  return OFFER_ENTRY_ON_RECORDS_GAP || !isGapCase(line);
}

/* ---------- undo bar (the shared toast has no action slot) ---------- */

type UndoState =
  | { id: number; kind: "nothing"; lineId: string; name: string }
  | { id: number; kind: "delete"; entryId: string; message: string };

function UndoBar({ message, onUndo, onAddNote, onDismiss }: { message: string; onUndo: () => void; onAddNote?: () => void; onDismiss: () => void }) {
  // External-system sync: a timer that dismisses the bar.
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, UNDO_MS);
    return () => window.clearTimeout(timer);
  });
  return (
    <div role="status" className={cn("fixed left-1/2 z-[var(--z-layer-popover)] flex w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 flex-wrap items-center gap-x-12 gap-y-4 bg-[var(--paper)] px-16 py-8 [border:var(--hair)]", FOOTER_LIFT)}>
      <span className="w-full min-w-0 body-small sm:w-auto sm:flex-1">{message}</span>
      <span className="flex items-center gap-4">
        {onAddNote && <Button size="small" variant="weak" onClick={() => { onAddNote(); onDismiss(); }}>Add note</Button>}
        <Button size="small" variant="default" onClick={() => { onUndo(); onDismiss(); }}>Undo</Button>
        <Button size="icon" variant="noOutline" aria-label="Dismiss" onClick={onDismiss}><XIcon size={16} weight="bold" /></Button>
      </span>
    </div>
  );
}

/* ---------- the page ---------- */

export function DetailC3C({ data: raw, batchId }: { data: Data; batchId: string }) {
  const data = useC3cData(raw);
  const detail = useBatchDetail(data, batchId);
  const { view } = detail;
  const [editing, setEditing] = useState(false);
  const [drawer, setDrawer] = useState<{ lineId: string; mode: DrawerMode } | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const drawerLine = drawer ? view.lines.find((l) => l.def.id === drawer.lineId) ?? null : null;

  const openDrawer = (line: PrototypeLine, mode: DrawerMode = { view: "ledger" }) => setDrawer({ lineId: line.def.id, mode });
  const markNothing = (line: PrototypeLine) => {
    prototypeActions.addEntry(view.batch, line.def.id, { kind: "nothing", date: defaultEntryDate(view.batch), files: [], note: "" });
    setUndo({ id: Date.now(), kind: "nothing", lineId: line.def.id, name: line.def.name });
  };
  const deleteEntry = (line: PrototypeLine, entry: PrototypeEntry) => {
    hiddenEntries.hide(entry.id);
    setUndo({ id: Date.now(), kind: "delete", entryId: entry.id, message: entry.kind === "nothing" ? `Nothing to record removed from ${line.def.name}.` : `Entry deleted on ${line.def.name}.` });
  };
  // Read at undo time: the zero entry is the line's current nothing entry.
  const undoLine = undo?.kind === "nothing" ? view.lines.find((l) => l.def.id === undo.lineId) : undefined;
  const undoBar = !undo || editing ? null : undo.kind === "nothing" ? (
    <UndoBar
      key={undo.id}
      message={`${undo.name} marked nothing to record.`}
      onUndo={() => { if (undoLine?.nothing) hiddenEntries.hide(undoLine.nothing.id); }}
      onAddNote={undoLine ? () => openDrawer(undoLine, { view: "ledger", focus: "note" }) : undefined}
      onDismiss={() => setUndo(null)}
    />
  ) : (
    <UndoBar key={undo.id} message={undo.message} onUndo={() => hiddenEntries.show(undo.entryId)} onDismiss={() => setUndo(null)} />
  );

  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        <DetailTopBar view={view} batches={data.batches} />
        <PageHeader
          title={view.batch.code}
          subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`}
          actions={editing ? null : <Button variant="primary" disabled={view.open.length === 0} onClick={() => { setUndo(null); setEditing(true); }}>Record this month</Button>}
        />
      </div>
      <DetailKpiStrip detail={detail} />
      {editing ? (
        <BulkGrid detail={detail} onDone={() => setEditing(false)} />
      ) : (
        <SourcesLedger detail={detail} onOpen={openDrawer} onNothing={markNothing} />
      )}
      <LedgerDrawer
        batch={view.batch}
        line={drawerLine}
        mode={drawer?.mode ?? { view: "ledger" }}
        setMode={(mode) => setDrawer((d) => (d ? { ...d, mode } : d))}
        onClose={() => setDrawer(null)}
        canAdd={drawerLine ? canAddEntry(drawerLine) : false}
        onNothing={(line) => { markNothing(line); }}
        onDelete={deleteEntry}
      />
      <EntrySheet sheet={detail.sheet} batches={data.batches} />
      {undoBar}
    </div>
  );
}

/* ---------- read mode ---------- */

function SourcesLedger({ detail, onOpen, onNothing }: { detail: BatchDetail; onOpen: (line: PrototypeLine, mode?: DrawerMode) => void; onNothing: (line: PrototypeLine) => void }) {
  const firstGap = detail.lines.find((line) => { const k = lineCase(line); return k === "B1" || k === "B2"; })?.def.id;
  const row = (line: PrototypeLine, showGroup: boolean) => (
    <Fragment key={line.def.id}>
      <LineRow line={line} showGroup={showGroup} onOpen={onOpen} onNothing={onNothing} />
      {line.def.id === firstGap && (
        <li className="px-16 py-8 [border-top:var(--row-divider)]">
          <ProtoNote>{`Open question: entry offered on a records gap. Add entry is ${OFFER_ENTRY_ON_RECORDS_GAP ? "offered" : "not offered"} here, with the warning in the form. One constant flips it.`}</ProtoNote>
        </li>
      )}
    </Fragment>
  );
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
            <div aria-hidden="true" className={cn(ROW_GRID, "hidden bg-[var(--sea)] px-16 py-10 body-small font-medium text-[var(--color-text-secondary)] md:grid")}>
              <span>Line</span>
              <span>State</span>
              <span>Sources</span>
              <span className="text-right">Total</span>
              <span />
            </div>
            <ul aria-label="Emission lines">
              {detail.grouped
                ? detail.groups.map((group) => (
                    <Fragment key={group.group}>
                      <li className="border-t border-[var(--color-border-tertiary)] px-16 pt-16 pb-4 body-caption font-medium text-[var(--color-text-tertiary)] first:border-t-0">{group.group}</li>
                      {group.lines.map((line) => row(line, false))}
                    </Fragment>
                  ))
                : detail.lines.map((line) => row(line, true))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function TotalCell({ line }: { line: PrototypeLine }) {
  if (line.state === "needsSetup") return <span className="text-[var(--color-text-tertiary)]">Needs setup</span>;
  if (line.def.shape === "gas" && line.values.length) {
    return (
      <>
        <span className="block whitespace-nowrap">{`${line.values[0].concentration} mg/kg`}</span>
        <span className="block whitespace-nowrap">{`${(line.values[0].massFlow ?? 0).toLocaleString("en-US")} kg`}</span>
      </>
    );
  }
  const empty = line.total == null && line.state !== "nothingToRecord";
  return <span className={cn(empty && "text-[var(--color-text-tertiary)]")}>{empty ? "Not recorded" : line.totalText}</span>;
}

interface LineRowProps {
  line: PrototypeLine;
  showGroup: boolean;
  onOpen: (line: PrototypeLine, mode?: DrawerMode) => void;
  onNothing: (line: PrototypeLine) => void;
}

function LineRow({ line, showGroup, onOpen, onNothing }: LineRowProps) {
  return (
    <li
      onClick={() => onOpen(line)}
      className={cn("group cursor-pointer px-16 py-12 [border-top:var(--row-divider)] hover:bg-[var(--row-hover-bg-solid)]", ROW_GRID, line.open && "bg-[var(--st-wait-bg)]/40")}
    >
      <div className="col-start-1 row-start-1 min-w-0">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(event) => { event.stopPropagation(); onOpen(line); }}
          className="min-h-24 text-left body-small font-medium underline-offset-4 group-hover:underline"
        >
          {line.def.name}
        </button>
        {showGroup && <span className="block body-caption text-[var(--color-text-tertiary)]">{line.def.group}</span>}
      </div>
      <div className="col-start-1 row-start-3 self-center md:col-start-2 md:row-start-1"><LineStateBadge state={line.state} /></div>
      <div className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
        <SourceChips line={line} onEntries={() => onOpen(line, { view: "ledger", focus: "entries" })} />
      </div>
      <div className="col-start-2 row-start-3 self-center text-right body-small font-medium tabular-nums md:col-start-4 md:row-start-1">
        <TotalCell line={line} />
      </div>
      <div className="col-start-2 row-start-1 -mt-8 -mr-8 flex items-start justify-end md:col-start-5 md:m-0 md:items-center" onClick={(event) => event.stopPropagation()}>
        <NothingButton line={line} onNothing={onNothing} />
        <RowMenu line={line} onOpen={onOpen} onNothing={onNothing} />
      </div>
    </li>
  );
}

/**
 * The one-tap Nothing to record icon. Always visible where it is allowed (every
 * such line is open, so it is the likely answer). Where it is refused it sits
 * disabled with its reason, revealed on row hover or focus on desktop so done
 * rows stay calm; phones have no hover, so there the reason lives in the ⋯ menu.
 * Lines it never applies to (CO₂ stored, Needs setup, already zero) keep the slot empty.
 */
function NothingButton({ line, onNothing }: { line: PrototypeLine; onNothing: (line: PrototypeLine) => void }) {
  if (!nothingApplies(line)) return <span aria-hidden="true" className="hidden w-44 md:block" />;
  const refusal = nothingToRecordRefusal(line);
  const base = "inline-flex size-44 items-center justify-center";
  if (refusal) {
    return (
      <Tooltip content={`Nothing to record is off. ${refusal}.`}>
        <button
          type="button"
          aria-disabled="true"
          aria-label={`Nothing to record, not available. ${refusal}`}
          onClick={(event) => event.preventDefault()}
          className={cn(base, "hidden cursor-not-allowed text-[var(--color-text-tertiary)] opacity-50 md:inline-flex md:opacity-0 md:group-hover:opacity-50 md:group-focus-within:opacity-50 md:focus-visible:opacity-50")}
        >
          <MinusCircleIcon size={18} aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Nothing to record">
      <button
        type="button"
        aria-label={`Nothing to record on ${line.def.name}`}
        onClick={() => onNothing(line)}
        className={cn(base, "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-medium)] hover:text-[var(--color-text-primary)]")}
      >
        <MinusCircleIcon size={18} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/** The short row menu (brief §5 C3c): Add entry, the upstream page, Nothing to record. Everything else is in the drawer. */
function RowMenu({ line, onOpen, onNothing }: { line: PrototypeLine; onOpen: (line: PrototypeLine, mode?: DrawerMode) => void; onNothing: (line: PrototypeLine) => void }) {
  const items = rowMenuItems(line)
    .filter((item) => (line.state === "needsSetup" ? item.key === "description" : ["add", "open", "nothing"].includes(item.key)))
    .filter((item) => item.key !== "add" || item.disabled || canAddEntry(line));
  const source = recordsSource(line);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger render={<Button variant="noOutline" size="icon" aria-label={`Actions for ${line.def.name}`} className="size-44 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" />}>
        <DotsThreeVerticalIcon size={20} weight="bold" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="max-w-[280px]">
        {items.map((item) => {
          const body: ReactNode = (
            <span className="flex flex-col">
              <span>{item.label}</span>
              {item.disabled && item.reason && <span className="body-caption">{item.reason}</span>}
            </span>
          );
          if (item.key === "open" && source.kind === "records") {
            return <DropdownMenu.Item key={item.key} render={<Link href={source.href} />}>{body}</DropdownMenu.Item>;
          }
          const select = item.key === "add" ? () => onOpen(line, { view: "form", mode: "add" })
            : item.key === "nothing" ? () => onNothing(line)
            : () => onOpen(line);
          return <DropdownMenu.Item key={item.key} disabled={item.disabled} onClick={select}>{body}</DropdownMenu.Item>;
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/* ---------- bulk grid ("Record this month") ---------- */

interface Draft { nothing: boolean; a: string; b: string; date: string; file: string | null; note: string }
type Drafts = Record<string, Draft>;
interface RowErrors { a?: string; b?: string; date?: string }

const isNumber = (raw: string) => /^\d+(?:\.\d+)?$/.test(raw.trim());
const isPaired = (line: PrototypeLine) => line.def.shape === "gas" || line.def.shape === "massDistance";
const isFileOnly = (line: PrototypeLine) => line.state === "missingEvidence";
/** Value inputs are offered: an empty line that takes entries, and a records gap only when the flag says so. */
const takesValue = (line: PrototypeLine) => line.state === "empty" && line.def.rule !== "none" && (OFFER_ENTRY_ON_RECORDS_GAP || !hasRecordsGap(line));
const isEditable = (line: PrototypeLine) => (line.state === "empty" && line.def.rule !== "none") || isFileOnly(line);
const plural = (n: number) => (n === 1 ? "line" : "lines");

function touched(line: PrototypeLine, d: Draft): boolean {
  if (isFileOnly(line)) return !!d.file;
  return d.nothing || !!(d.a.trim() || d.b.trim() || d.file);
}

/** The note is optional for Nothing to record (Kenji, amendment 2). */
function validate(line: PrototypeLine, d: Draft, startDate: string): RowErrors {
  const errors: RowErrors = {};
  if (isFileOnly(line)) return errors;
  if (!d.nothing) {
    if (!isNumber(d.a)) errors.a = MSG_NUMBER;
    if (isPaired(line) && !isNumber(d.b)) errors.b = MSG_NUMBER;
  }
  if (d.date < startDate) errors.date = MSG_DATE;
  return errors;
}

function toDraft(line: PrototypeLine, d: Draft): EntryDraft | null {
  const { def } = line;
  if (isFileOnly(line)) {
    const entry = line.values.find((e) => !e.files.length);
    if (!entry || !d.file) return null;
    return { kind: entry.kind, date: entry.date, value: entry.value, mass: entry.mass, distance: entry.distance, concentration: entry.concentration, massFlow: entry.massFlow, note: entry.note, files: [d.file] };
  }
  if (d.nothing) return { kind: "nothing", date: d.date, files: [], note: d.note.trim() };
  const amounts = def.shape === "gas" ? { concentration: Number(d.a), massFlow: Number(d.b) }
    : def.shape === "massDistance" ? { mass: Number(d.a), distance: Number(d.b) }
    : { value: Number(d.a) };
  return { kind: "value", date: d.date, note: d.note.trim(), files: d.file ? [d.file] : [], ...amounts };
}

function draftFigure(line: PrototypeLine, d: Draft): number | null {
  if (d.nothing) return 0;
  if (line.def.shape === "gas") return null;
  if (line.def.shape === "massDistance") return isNumber(d.a) && isNumber(d.b) ? (Number(d.a) * Number(d.b)) / KG_PER_TONNE : null;
  return isNumber(d.a) ? Number(d.a) : null;
}

function BulkGrid({ detail, onDone }: { detail: BatchDetail; onDone: () => void }) {
  const toast = useToast();
  const { view } = detail;
  const [showDone, setShowDone] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const blank = (): Draft => ({ nothing: false, a: "", b: "", date: view.batch.endDate, file: null, note: "" });
  const draftOf = (id: string): Draft => drafts[id] ?? blank();
  const patch = (id: string, change: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...(all[id] ?? blank()), ...change } }));

  const gridLines = view.lines.filter((line) => line.open);
  const doneLines = view.lines.filter((line) => !line.open);
  const gapLines = gridLines.filter(hasRecordsGap);
  const status = gridLines.filter(isEditable).filter((line) => touched(line, draftOf(line.def.id))).map((line) => {
    const d = draftOf(line.def.id);
    const errors = validate(line, d, view.batch.startDate);
    return { line, d, errors, ok: Object.keys(errors).length === 0 };
  });
  const ready = status.filter((s) => s.ok).length;
  const missingFile = status.filter((s) => s.ok && !isFileOnly(s.line) && !s.d.nothing && !s.d.file).length;
  const failing = status.filter((s) => !s.ok).length;

  const saveAll = () => {
    setAttempted(true);
    const count = { values: 0, nothings: 0, files: 0 };
    const left: Drafts = { ...drafts };
    for (const s of status) {
      if (!s.ok) continue;
      const entry = toDraft(s.line, s.d);
      if (!entry) continue;
      if (isFileOnly(s.line)) {
        const target = s.line.values.find((e) => !e.files.length);
        if (target) prototypeActions.updateEntry(view.batch, target.id, entry);
        count.files += 1;
      } else {
        prototypeActions.addEntry(view.batch, s.line.def.id, entry);
        if (entry.kind === "nothing") count.nothings += 1; else count.values += 1;
      }
      delete left[s.line.def.id];
    }
    setDrafts(left);
    const firstBad = status.find((s) => !s.ok);
    if (firstBad) {
      const key = firstBad.errors.a ? "0" : firstBad.errors.b ? "1" : "date";
      const target = document.getElementById(`c3c-${firstBad.line.def.id}-${key}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center" });
    }
    const parts = [
      count.values ? `${count.values} ${count.values === 1 ? "entry" : "entries"}` : "",
      count.nothings ? `${count.nothings} marked nothing to record` : "",
      count.files ? `${count.files} ${count.files === 1 ? "file" : "files"} added` : "",
    ].filter(Boolean);
    if (parts.length) toast.success(`Saved ${parts.join(", ")}.${failing ? ` ${failing} ${plural(failing)} still ${failing === 1 ? "needs" : "need"} fixing.` : ""}`);
    if (!failing) onDone();
  };

  const statusText = [
    ready ? `${ready} ${plural(ready)} ready` : "No lines ready yet",
    missingFile ? `${missingFile} missing a file` : "",
    attempted && failing ? `${failing} to fix` : "",
  ].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="body-large font-medium">{`Open lines, ${gridLines.length}`}</h2>
          <p className="body-caption text-[var(--color-text-secondary)]">Fill what you have. Lines you leave empty stay open. Records stay as they are; what you type adds on top.</p>
        </div>
        <Button variant="weak" aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide done lines" : `Show done lines (${doneLines.length})`}
        </Button>
      </div>
      <div className="[border:var(--panel-border)] bg-[var(--paper)]">
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
                <li key={line.def.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12 gap-y-6 px-16 py-10 body-small [border-top:var(--row-divider)] md:grid-cols-[minmax(0,1.25fr)_148px_minmax(0,1fr)_168px]">
                  <span className="min-w-0">{line.def.name}</span>
                  <span className="justify-self-end md:justify-self-start"><LineStateBadge state={line.state} /></span>
                  <span className="col-span-2 md:col-span-1"><SourceChips line={line} interactive={false} /></span>
                  <span className="hidden text-right tabular-nums text-[var(--color-text-secondary)] md:block">{line.totalText}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className={cn("sticky z-10 -mx-16 flex flex-col gap-8 border-t border-[var(--color-border-primary)] bg-[var(--paper)] px-16 py-10 sm:mx-0 sm:border", FOOTER_LIFT)}>
        {gapLines.length > 0 && (
          <Notice tone="warning">{`${gapLines.length} ${plural(gapLines.length)} ${gapLines.length === 1 ? "has" : "have"} a records source with nothing recorded. Fuel used in a run belongs on the run, a delivery on its own record.`}</Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-8">
          <p role="status" className={cn("body-small font-medium", attempted && failing && "text-[var(--st-bad)]")}>{statusText}</p>
          <div className="flex gap-8">
            <Button variant="weak" onClick={onDone}>Cancel</Button>
            <Button variant="primary" disabled={status.length === 0} onClick={saveAll}>Save all</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GridRowProps { line: PrototypeLine; detail: BatchDetail; draft: Draft; errors: RowErrors; onChange: (change: Partial<Draft>) => void }

function GridRow({ line, detail, draft, errors, onChange }: GridRowProps) {
  const { view, actions } = detail;
  const { def } = line;
  const id = def.id;
  const month = new Date(`${view.batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const labels = def.shape === "gas" ? GAS_INPUTS.map((i) => [i.label, i.unit]) : def.shape === "massDistance" ? [["Mass", "kg"], ["Distance", "km"]] : [[def.inputLabel, def.unit]];
  const canNothing = line.state === "empty" && def.rule !== "none";
  const gap = hasRecordsGap(line);
  const preview = totalAfter(line, draftFigure(line, draft));
  const typed = draftFigure(line, draft) != null;
  const source = recordsSource(line);

  const chips = <SourceChips line={line} interactive={false} quiet={false} />;
  const chipsWithHint = gap ? (
    <Tooltip content={entryGuard(line) ?? ""}>
      <span tabIndex={0} className="inline-flex outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]">{chips}</span>
    </Tooltip>
  ) : chips;

  const fileSlot = (
    <span className="inline-flex items-center gap-4">
      <label className="inline-flex min-h-44 cursor-pointer items-center gap-6 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 body-small focus-within:border-[var(--color-interaction)]">
        <PaperclipIcon size={16} weight="bold" aria-hidden="true" />
        <span className="max-w-[200px] truncate">{draft.file ?? "Attach file"}</span>
        <input type="file" aria-label={`File for ${def.name}`} className="sr-only" onChange={(e) => onChange({ file: e.target.files?.[0]?.name ?? null })} />
      </label>
      {draft.file && (
        <button type="button" aria-label={`Remove file from ${def.name}`} onClick={() => onChange({ file: null })} className="inline-flex size-44 items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <XIcon size={16} weight="bold" aria-hidden="true" />
        </button>
      )}
      {def.yearlyReport && draft.file !== YEARLY_REPORT_FILE && (
        <button type="button" onClick={() => onChange({ file: YEARLY_REPORT_FILE })} className="inline-flex min-h-44 items-center px-8 body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">
          {`Use ${YEARLY_REPORT_FILE}`}
        </button>
      )}
    </span>
  );

  let body: ReactNode;
  if (line.state === "needsReview") {
    body = <ReviewBlock line={line} batch={view.batch} onEnterAgain={() => actions.openSheet(id, "again")} />;
  } else if (line.state === "needsSetup") {
    body = view.batch.real ? (
      <Link href={creditBatchSheetHref(view.batch)} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">Set up in the credit batch</Link>
    ) : <NeedsSetupText />;
  } else if (isFileOnly(line)) {
    const missingEntry = line.values.find((e) => !e.files.length);
    body = (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center gap-8">{chips}</div>
        <p className="body-small text-[var(--color-text-secondary)]">{missingEntry ? `The ${formatDate(missingEntry.date)} entry has no file.` : "An entry has no file."}</p>
        <div>{fileSlot}</div>
      </div>
    );
  } else {
    const valueAllowed = takesValue(line);
    body = (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-end gap-x-12 gap-y-8">
          {(source.kind === "records" || line.values.length > 0) && (
            <span className="flex min-h-[40px] items-center gap-8">
              {chipsWithHint}
              {(valueAllowed || draft.nothing) && <span aria-hidden="true" className="title-heading-4 leading-none text-[var(--color-text-tertiary)]">+</span>}
            </span>
          )}
          {draft.nothing ? (
            <div className="w-full sm:min-w-[260px] sm:flex-1">
              <FormField id={`c3c-${id}-note`} label="Note" cue="Optional">
                <Input id={`c3c-${id}-note`} value={draft.note} onChange={(e) => onChange({ note: e.target.value })} placeholder={`For example: No staff flights in ${month}`} />
              </FormField>
            </div>
          ) : valueAllowed ? (
            labels.map(([label, unit], index) => {
              const key = index === 0 ? "a" : "b";
              return (
                <div key={label} className="w-full sm:w-[200px]">
                  <FormField id={`c3c-${id}-${index}`} label={label} unit={unit} error={errors[key]}>
                    <Input id={`c3c-${id}-${index}`} inputMode="decimal" value={draft[key]} onChange={(e) => onChange({ [key]: e.target.value })} />
                  </FormField>
                </div>
              );
            })
          ) : source.kind === "records" ? (
            <Link href={source.href} className="inline-flex min-h-44 items-center body-small text-[var(--color-text-interaction-primary)] underline underline-offset-4">{`Record it on the ${source.label}`}</Link>
          ) : null}
          {(valueAllowed || draft.nothing) && (
            <div className="w-full sm:w-[168px]">
              <FormField id={`c3c-${id}-date`} label="Date" error={errors.date}>
                <Input id={`c3c-${id}-date`} type="date" value={draft.date} min={view.batch.startDate} onChange={(e) => onChange({ date: e.target.value })} />
              </FormField>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-16">
          {!draft.nothing && valueAllowed && fileSlot}
          {canNothing && (
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
      </div>
    );
  }

  const showPreview = def.shape !== "gas" && line.state !== "needsSetup" && line.state !== "needsReview";
  return (
    <li className="grid gap-12 px-16 py-12 [border-top:var(--row-divider)] first:border-t-0 lg:grid-cols-[220px_minmax(0,1fr)_200px] lg:gap-24">
      <div className="flex flex-col items-start gap-4">
        <span className="body-small font-medium">{def.name}</span>
        <span className="body-caption text-[var(--color-text-tertiary)]">{def.group}</span>
        {line.state !== "empty" && <LineStateBadge state={line.state} />}
      </div>
      {body}
      {showPreview && (
        <div className="flex flex-col gap-4 lg:items-end" aria-live="polite">
          <span className="body-caption text-[var(--color-text-tertiary)]">Total</span>
          <span className="flex flex-wrap items-center gap-8 tabular-nums">
            <span className={cn("[border:var(--hair-2)] px-8 py-4 body-small", !typed && "text-[var(--color-text-tertiary)]")}>{preview.before}</span>
            {typed && (
              <>
                <ArrowRightIcon size={14} weight="bold" aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
                <span className="[border:var(--hair)] px-8 py-4 body-small font-medium">{draft.nothing ? `0 ${def.unit}` : preview.after}</span>
              </>
            )}
          </span>
        </div>
      )}
    </li>
  );
}
