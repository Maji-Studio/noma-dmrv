/**
 * PROTOTYPE detail C3b, "Stacked figure, inline ledger" (round 3 brief §5).
 *
 * One Total column. Under each Total sits a stacked figure: a thin bar whose
 * plum part is From records and whose violet part is the entries laid on top,
 * then the composition as a written sum ("18,420 kWh from 22 production runs"
 * over "+ 1,460 kWh from 2 entries"). A records gap draws as a dashed slot.
 *
 * A row click opens the inline ledger in place (one at a time, `?line=`): the
 * row's own columns continue downward as an addition, records, + entries,
 * = Total, with each figure under the Total column and each entry date under
 * Last entry. No drawer. Add entry opens the entry sheet so the ledger stays
 * readable. Records are read only here and link to their source page.
 *
 * Keeps C3's KPI strip, chips, sort, pager and "Record this month" with Save
 * all (prototype-detail-c3b-parts.tsx, with the add form).
 */
"use client";

import { Fragment, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { DotsThreeVerticalIcon, FileIcon, NumberCircleZeroIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, Input, PageHeader, buttonVariants } from "@/components/ui";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  PROTOTYPE_TEMPLATE_NAME,
  deriveLines,
  entriesFor,
  entryAmount,
  entryText,
  formatFigure,
  formatNumber,
  openLines,
  prototypeActions,
  type PrototypeEntry,
  type PrototypeLine,
} from "./prototype-emissions-data";
import { DisclosureButton, LineStateBadge, ProtoNote, batchPeriod, type usePrototypeEmissions } from "./prototype-emissions-shared";
import { DetailKpiStrip, DetailTopBar, LineSortSelect, LineStateChips, NoLinesMatch, lastEntryDate, useBatchDetail, type BatchDetail } from "./prototype-detail-shared";
import { compositionCaption, entriesText, entryGuard, lineCase, nothingToRecordRefusal, recordsSource, recordsText, rowMenuItems, type RowMenuItem } from "./prototype-line-sources";
import { C3bEntrySheet, MonthGrid, RecordsLink, entryDraft, openLabel, useC3bSheet, type C3bTarget } from "./prototype-detail-c3b-parts";

/**
 * Open question for Kenji (amendment 5): offer Add entry on a line whose
 * records source exists but holds nothing (cases B1, B2, F). Flip to false to
 * send the operator upstream only.
 */
const OFFER_ENTRY_ON_RECORDS_GAP = true;

type Data = ReturnType<typeof usePrototypeEmissions>;
const TODAY = new Date().toISOString().slice(0, 10);
const UNDO_MS = 8000;
const MIN_SEGMENT_PCT = 3;
const GAP_SLOT_PX = 16;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** One grid for the header, the rows and the ledger lines, so the ledger's figures sit under Total. */
const ROW_GRID = "md:grid md:grid-cols-[minmax(0,1fr)_148px_280px_88px] md:gap-x-16 lg:grid-cols-[minmax(0,1fr)_148px_280px_104px_88px]";
const COL_LABEL = "md:[grid-column:1/3]";
const COL_FIGURE = "md:[grid-column:3/4]";
const COL_DATE = "hidden lg:block lg:[grid-column:4/5]";
const COL_ACTIONS = "md:[grid-column:-2/-1]";
const OP = "inline-flex w-16 shrink-0 justify-center font-medium";

export const DETAIL_C3B_NAME = "Stacked figure";

const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const nothingDate = (endDate: string) => (endDate < TODAY ? endDate : TODAY);

/* ---------- local tombstones (the stub has no delete) ---------- */

let hiddenIds: ReadonlySet<string> = new Set();
const hiddenListeners = new Set<() => void>();
function setHidden(next: ReadonlySet<string>) {
  hiddenIds = next;
  for (const listener of hiddenListeners) listener();
}
const subscribeHidden = (listener: () => void) => {
  hiddenListeners.add(listener);
  return () => void hiddenListeners.delete(listener);
};
const hideEntry = (id: string) => setHidden(new Set([...hiddenIds, id]));
const unhideEntry = (id: string) => setHidden(new Set([...hiddenIds].filter((x) => x !== id)));

function withHidden(data: Data, hidden: ReadonlySet<string>): Data {
  if (!hidden.size) return data;
  return {
    ...data,
    batches: data.batches.map((view) => {
      const lines = deriveLines(view.batch, entriesFor(data.store, view.batch).filter((entry) => !hidden.has(entry.id)));
      return { ...view, lines, open: openLines(lines) };
    }),
  };
}

/* ---------- the page ---------- */

interface Undo { message: string; lineId: string; undo: () => void; addNote?: boolean }

export function DetailC3B({ data: raw, batchId }: { data: Data; batchId: string }) {
  const hidden = useSyncExternalStore(subscribeHidden, () => hiddenIds, () => hiddenIds);
  const data = withHidden(raw, hidden);
  const detail = useBatchDetail(data, batchId);
  const toast = useToast();
  const sheet = useC3bSheet();
  const { view } = detail;
  const [openLine, setOpenLine] = useQueryState("line", parseAsString.withOptions({ history: "replace", scroll: false }));
  const [editing, setEditing] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<number | null>(null);

  const showUndo = (next: Undo) => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndo(next);
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  };
  const lineOf = (lineId: string) => view.lines.find((l) => l.def.id === lineId);

  const markNothing = (line: PrototypeLine) => {
    prototypeActions.addEntry(view.batch, line.def.id, { kind: "nothing", date: nothingDate(view.batch.endDate), files: [], note: "" });
    showUndo({
      message: `${line.def.name} marked nothing to record.`,
      lineId: line.def.id,
      addNote: true,
      undo: () => {
        // The zero is found at undo time: the stub does not return the new id.
        const zero = lineOf(line.def.id)?.nothing;
        if (zero) hideEntry(zero.id);
      },
    });
  };
  const deleteEntry = (line: PrototypeLine, entry: PrototypeEntry) => {
    hideEntry(entry.id);
    showUndo({ message: `Entry deleted from ${line.def.name}.`, lineId: line.def.id, undo: () => unhideEntry(entry.id) });
  };
  const saveNote = (line: PrototypeLine, note: string) => {
    if (line.nothing) prototypeActions.updateEntry(view.batch, line.nothing.id, entryDraft(line.nothing, { note: note.trim() }));
    setNoteFor(null);
    toast.success(`Note saved on ${line.def.name}.`);
  };

  const ops: LineOps = {
    toggle: (lineId) => void setOpenLine(openLine === lineId ? null : lineId),
    expand: (lineId) => void setOpenLine(lineId),
    open: (target) => sheet.show(target),
    nothing: markNothing,
    deleteEntry,
    confirm: (lineId) => detail.actions.confirm(lineId),
    noteFor,
    setNoteFor,
    saveNote,
  };

  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-4">
        <DetailTopBar view={view} batches={data.batches} />
        <PageHeader
          title={view.batch.code}
          subtitle={`${batchPeriod(view.batch)}. ${PROTOTYPE_TEMPLATE_NAME}.`}
          actions={editing ? null : <Button variant="primary" disabled={view.open.length === 0} onClick={() => setEditing(true)}>Record this month</Button>}
        />
      </div>
      <DetailKpiStrip detail={detail} />
      {editing ? (
        <MonthGrid detail={detail} offerOnGap={OFFER_ENTRY_ON_RECORDS_GAP} onClose={() => setEditing(false)} onEnterAgain={(lineId) => sheet.show({ lineId, mode: "again" })} />
      ) : (
        <ReadLedger detail={detail} openLine={openLine} ops={ops} />
      )}
      <C3bEntrySheet sheet={sheet} batch={view.batch} lines={view.lines} />
      {undo && (
        <div role="status" className="fixed bottom-[72px] left-1/2 z-[var(--z-layer-popover)] flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-center justify-between gap-x-16 gap-y-4 bg-[var(--paper)] px-16 py-8 [border:var(--hair)]">
          <span className="body-small">{undo.message}</span>
          <span className="flex gap-4">
            {undo.addNote && (
              <Button size="small" variant="noOutline" onClick={() => { setOpenLine(undo.lineId); setNoteFor(undo.lineId); setUndo(null); }}>Add note</Button>
            )}
            <Button size="small" variant="weak" onClick={() => { undo.undo(); setUndo(null); }}>Undo</Button>
          </span>
        </div>
      )}
    </div>
  );
}

interface LineOps {
  toggle: (lineId: string) => void;
  expand: (lineId: string) => void;
  open: (target: C3bTarget) => void;
  nothing: (line: PrototypeLine) => void;
  deleteEntry: (line: PrototypeLine, entry: PrototypeEntry) => void;
  confirm: (lineId: string) => void;
  noteFor: string | null;
  setNoteFor: (lineId: string | null) => void;
  saveNote: (line: PrototypeLine, note: string) => void;
}

/* ---------- read view ---------- */

function ReadLedger({ detail, openLine, ops }: { detail: BatchDetail; openLine: string | null; ops: LineOps }) {
  const firstGap = detail.lines.find((line) => ["B1", "B2"].includes(lineCase(line)))?.def.id;
  const row = (line: PrototypeLine, showGroup: boolean) => (
    <Fragment key={line.def.id}>
      <LineRow line={line} showGroup={showGroup} expanded={openLine === line.def.id} ops={ops} batchCode={detail.view.batch.code} dryFeedstockT={detail.view.batch.dryFeedstockT} />
      {line.def.id === firstGap && (
        <li className="px-16 py-8 [border-top:var(--row-divider)]">
          <ProtoNote>{`Open question: entry offered on a records gap. Add entry stays on lines whose records source holds nothing (OFFER_ENTRY_ON_RECORDS_GAP = ${OFFER_ENTRY_ON_RECORDS_GAP}).`}</ProtoNote>
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
            <div aria-hidden="true" className={cn(ROW_GRID, "hidden bg-[var(--sea)] px-16 py-10 body-small font-medium text-[var(--color-text-secondary)]")}>
              <span>Line</span>
              <span>State</span>
              <span className="text-right">Total</span>
              <span className="hidden lg:block">Last entry</span>
              <span />
            </div>
            <ul aria-label={`Emission lines of ${detail.view.batch.code}`}>
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
      <p className="body-caption text-[var(--color-text-tertiary)]">
        <span className="mr-6 inline-block h-[6px] w-16 bg-[var(--clr-dark-purple-40)] align-middle" aria-hidden="true" />
        {"From records "}
        <span className="mx-6 inline-block h-[6px] w-16 bg-[var(--clr-purple)] align-middle" aria-hidden="true" />
        {"Entries, on top "}
        <span className="mx-6 inline-block h-[6px] w-16 border border-dashed border-[var(--st-wait)] align-middle" aria-hidden="true" />
        Records source with nothing recorded
      </p>
      <ProtoNote>Records links open the unfiltered page. The real links filter to the credit batch window.</ProtoNote>
    </div>
  );
}

/* ---------- a row ---------- */

function LineRow({ line, showGroup, expanded, ops, batchCode, dryFeedstockT }: { line: PrototypeLine; showGroup: boolean; expanded: boolean; ops: LineOps; batchCode: string; dryFeedstockT: number }) {
  const { def } = line;
  const last = lastEntryDate(line);
  const ledgerId = `c3b-ledger-${def.id}`;
  return (
    <li className="[border-top:var(--row-divider)]">
      <div
        onClick={() => ops.toggle(def.id)}
        className={cn(
          ROW_GRID,
          "group relative grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-12 gap-y-6 px-16 py-12 hover:bg-[var(--row-hover-bg-solid)] focus-within:bg-[var(--row-hover-bg-solid)]",
          line.open && !expanded && "bg-[var(--st-wait-bg)]/40",
          expanded && "bg-[var(--sea)]",
        )}
      >
        <div className="min-w-0">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={ledgerId}
            onClick={(event) => { event.stopPropagation(); ops.toggle(def.id); }}
            className="min-h-24 text-left body-small font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--color-interaction)]"
          >
            {def.name}
          </button>
          {showGroup && <span className="block body-caption text-[var(--color-text-tertiary)]">{def.group}</span>}
          <span className="mt-6 block md:hidden"><LineStateBadge state={line.state} /></span>
        </div>
        <div className="hidden md:block"><LineStateBadge state={line.state} /></div>
        <div className="col-span-2 md:col-span-1"><StackedFigure line={line} /></div>
        <div className="hidden body-small whitespace-nowrap text-[var(--color-text-secondary)] lg:block">{last ? formatDate(last) : "None"}</div>
        <div className="col-start-2 row-start-1 flex items-start justify-end gap-2 md:col-start-auto md:row-start-auto">
          <NothingIcon line={line} onMark={() => ops.nothing(line)} />
          <RowMenu line={line} ops={ops} />
        </div>
      </div>
      {expanded && (
        <div id={ledgerId} className="bg-[var(--sea)] px-16 pb-16">
          <InlineLedger line={line} ops={ops} batchCode={batchCode} dryFeedstockT={dryFeedstockT} />
        </div>
      )}
    </li>
  );
}

/** Total on top, then the bar, then the composition written as a sum. */
function StackedFigure({ line }: { line: PrototypeLine }) {
  const kind = lineCase(line);
  const { def } = line;
  if (line.state === "needsSetup") return <p className="body-small text-left text-[var(--color-text-tertiary)] md:text-right">Needs setup</p>;
  const gas = def.shape === "gas" && line.values.length > 0;
  const muted = line.total == null && kind !== "Z" && !gas;
  const parts = compositionCaption(line).split(" + ");
  const hasSource = recordsSource(line).kind === "records";
  const missingFile = line.values.some((e) => !e.files.length);
  return (
    <div className="flex flex-col gap-4 text-left md:items-end md:text-right">
      {gas ? (
        <p className="body-small font-medium tabular-nums">
          <span className="block whitespace-nowrap">{`${formatNumber(line.values[0].concentration ?? 0)} mg/kg`}</span>
          <span className="block whitespace-nowrap">{`${formatNumber(line.values[0].massFlow ?? 0, 0)} kg`}</span>
        </p>
      ) : (
        <p className={cn("body-small tabular-nums", muted ? "text-[var(--color-text-tertiary)]" : "font-medium")}>{line.totalText}</p>
      )}
      {hasSource && <SourceBar line={line} />}
      <div className="flex flex-col body-caption text-[var(--color-text-secondary)] md:items-end">
        {kind === "S" || kind === "Z" || kind === "A" ? (
          <span className={cn(kind === "A" && "text-[var(--color-text-tertiary)]")}>{gas ? "One entry per credit batch" : parts[0]}</span>
        ) : (
          parts.map((part, index) => {
            const isRecords = index === 0 && hasSource;
            const gap = isRecords && line.records?.value == null;
            if (isRecords) {
              return (
                <RecordsLink key={part} line={line} className={cn("self-start md:self-end", gap ? "text-[var(--st-wait)]" : "text-[var(--color-text-secondary)]")}>
                  {part}
                </RecordsLink>
              );
            }
            return (
              <span key={part} className="inline-flex items-baseline gap-4">
                {hasSource && <><span aria-hidden="true" className="font-medium text-[var(--acc-infra-ink)]">+</span><span className="sr-only">plus</span></>}
                {/* Without records the figure is the Total above, so the caption names only its origin. */}
                <span>{hasSource ? part : part.replace(/^.+? from /, "From ")}</span>
              </span>
            );
          })
        )}
        {missingFile && (
          <span className="inline-flex items-center gap-4 text-[var(--st-wait)]"><WarningIcon size={12} weight="bold" aria-hidden="true" />File missing</span>
        )}
        {line.review.map((entry) => (
          <span key={entry.id} className="text-[var(--color-text-tertiary)]">
            <span className="line-through">{`${entryText(def, entry)}, ${shortDate(entry.date)}`}</span>
            {" Stopped counting"}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Records in plum, entries in violet laid on top; a dashed slot where records hold nothing. */
function SourceBar({ line }: { line: PrototypeLine }) {
  const records = line.auto?.value ?? 0;
  const entries = line.values.reduce((sum, e) => sum + entryAmount(line.def, e), 0);
  const total = records + entries;
  const gap = line.records?.value == null;
  const label = gap
    ? `Records hold nothing${entries ? `, entries ${formatFigure(entries, line.def.unit)}` : ""}`
    : `Records ${Math.round((records / total) * 100)} percent, entries ${Math.round((entries / total) * 100)} percent`;
  const entriesPct = total > 0 && entries > 0 ? Math.max(MIN_SEGMENT_PCT, (entries / total) * 100) : 0;
  return (
    <div role="img" aria-label={label} className="flex h-[6px] w-full max-w-[200px] gap-[2px] md:max-w-[240px]">
      {gap ? (
        <span className={cn("h-full border border-dashed border-[var(--st-wait)]", entries ? "shrink-0" : "flex-1")} style={entries ? { width: GAP_SLOT_PX } : undefined} />
      ) : (
        <span className="h-full bg-[var(--clr-dark-purple-40)]" style={{ width: `${100 - entriesPct}%` }} />
      )}
      {entries > 0 && <span className={cn("h-full bg-[var(--clr-purple)]", gap && "flex-1")} style={gap ? undefined : { width: `${entriesPct}%` }} />}
    </div>
  );
}

/* ---------- row actions ---------- */

/**
 * One tap, no form; the note is optional and added afterwards. Always shown on
 * rows where it is allowed and the line is still open, because that is where
 * it gets used. Elsewhere it waits for row hover or focus on desktop, and a
 * refused one is disabled with its reason as the tooltip. On phones a refused
 * one stays out of the card; the ⋯ menu carries the same item and reason.
 */
function NothingIcon({ line, onMark }: { line: PrototypeLine; onMark: () => void }) {
  const kind = lineCase(line);
  if (kind === "Z" || kind === "R" || line.state === "needsSetup") return <span className="hidden w-[32px] md:block" aria-hidden="true" />;
  const refusal = nothingToRecordRefusal(line);
  const prominent = !refusal && line.state === "empty";
  return (
    <Tooltip content={refusal ? `Nothing to record is not available: ${refusal.toLowerCase()}.` : "Nothing to record"}>
      <Button
        variant="noOutline"
        size="icon"
        aria-label="Nothing to record"
        aria-disabled={refusal ? true : undefined}
        aria-description={refusal ?? undefined}
        onClick={(event) => { event.stopPropagation(); if (!refusal) onMark(); }}
        className={cn(
          refusal ? "cursor-not-allowed text-[var(--color-text-tertiary)] opacity-50" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
          !prominent && "hidden md:inline-flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100",
          !prominent && refusal && "md:group-hover:opacity-50 md:group-focus-within:opacity-50",
        )}
      >
        <NumberCircleZeroIcon size={20} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}

function RowMenu({ line, ops }: { line: PrototypeLine; ops: LineOps }) {
  const kind = lineCase(line);
  const gapEntryHidden = !OFFER_ENTRY_ON_RECORDS_GAP && ["B1", "B2", "F"].includes(kind);
  const items = rowMenuItems(line).filter((item) => !(item.key === "add" && gapEntryHidden));
  const run = (item: RowMenuItem) => {
    if (item.key === "add") ops.open({ lineId: line.def.id, mode: "add" });
    if (item.key === "addFile") {
      const entry = line.values.find((e) => !e.files.length);
      if (entry) ops.open({ lineId: line.def.id, mode: "edit", entryId: entry.id });
    }
    if (item.key === "confirm") ops.confirm(line.def.id);
    if (item.key === "nothing") ops.nothing(line);
    if (item.key === "description") ops.expand(line.def.id);
  };
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger render={<Button variant="noOutline" size="icon" aria-label={`Actions for ${line.def.name}`} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" />}>
          <DotsThreeVerticalIcon size={20} weight="bold" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="min-w-[240px]">
          {items.map((item) => {
            const body = (
              <span className="flex flex-col gap-2">
                <span className={cn(item.disabled && "text-[var(--color-text-tertiary)]")}>{item.label}</span>
                {item.reason && <span className="body-caption text-[var(--color-text-secondary)]">{item.reason}</span>}
              </span>
            );
            const cls = "min-h-44 data-[disabled]:opacity-100";
            return item.href ? (
              <DropdownMenu.Item key={item.key} className={cls} render={<Link href={item.href} />}>{body}</DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item key={item.key} className={cls} disabled={item.disabled} onClick={() => run(item)}>{body}</DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

/* ---------- the inline ledger ---------- */

function LedgerLine({ op, label, figure, date, actions, tone, className }: { op?: string; label: ReactNode; figure?: ReactNode; date?: string; actions?: ReactNode; tone?: "records" | "entries" | "gap"; className?: string }) {
  return (
    <div className={cn(ROW_GRID, "grid grid-cols-[minmax(0,1fr)_auto_32px] items-baseline gap-x-12 py-6", className)}>
      <div className={cn(COL_LABEL, "flex min-w-0 items-baseline gap-4")}>
        <span aria-hidden="true" className={cn(OP, tone === "entries" ? "text-[var(--acc-infra-ink)]" : "text-[var(--color-text-secondary)]")}>{op}</span>
        {op && <span className="sr-only">{op === "+" ? "plus" : "equals"}</span>}
        <div
          className={cn(
            "min-w-0 flex-1 border-l-2 pl-10",
            tone === "records" && "border-[var(--clr-dark-purple-40)]",
            tone === "entries" && "border-[var(--clr-purple)]",
            tone === "gap" && "border-dashed border-[var(--st-wait)]",
            !tone && "border-transparent",
          )}
        >
          {label}
        </div>
      </div>
      <div className={cn(COL_FIGURE, "text-right body-small tabular-nums")}>{figure}</div>
      {date && <div className={cn(COL_DATE, "body-small text-[var(--color-text-secondary)]")}>{formatDate(date)}</div>}
      <div className={cn(COL_ACTIONS, "flex justify-end")}>{actions}</div>
    </div>
  );
}

function EntryMenu({ line, entry, ops }: { line: PrototypeLine; entry: PrototypeEntry; ops: LineOps }) {
  const zero = entry.kind === "nothing";
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger render={<Button variant="noOutline" size="icon" aria-label={`Actions for the ${formatDate(entry.date)} entry`} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" />}>
          <DotsThreeVerticalIcon size={18} weight="bold" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {zero ? (
            <DropdownMenu.Item className="min-h-44" onClick={() => ops.setNoteFor(line.def.id)}>{entry.note ? "Edit note" : "Add note"}</DropdownMenu.Item>
          ) : (
            <>
              <DropdownMenu.Item className="min-h-44" onClick={() => ops.open({ lineId: line.def.id, mode: "edit", entryId: entry.id })}>Edit entry</DropdownMenu.Item>
              {!entry.files.length && <DropdownMenu.Item className="min-h-44" onClick={() => ops.open({ lineId: line.def.id, mode: "edit", entryId: entry.id })}>Add file</DropdownMenu.Item>}
            </>
          )}
          <DropdownMenu.Separator />
          <DropdownMenu.Item className="min-h-44" destructive onClick={() => ops.deleteEntry(line, entry)}>Delete entry</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

function EntryLabel({ line, entry, ops }: { line: PrototypeLine; entry: PrototypeEntry; ops: LineOps }) {
  const zero = entry.kind === "nothing";
  const editingNote = zero && ops.noteFor === line.def.id;
  return (
    <div className={cn("flex flex-col gap-2 body-small", !entry.counts && "text-[var(--color-text-tertiary)]")}>
      <span className="flex flex-wrap items-baseline gap-x-8">
        <span className={cn(!entry.counts && "line-through")}>{zero ? "Nothing to record" : line.def.shape === "massDistance" ? entryText(line.def, entry) : entry.note || "Entry"}</span>
        <span className="body-caption text-[var(--color-text-tertiary)] lg:hidden">{formatDate(entry.date)}</span>
      </span>
      {!zero && (
        <span className={cn("inline-flex items-center gap-4 body-caption", entry.files.length ? "text-[var(--color-text-secondary)]" : "text-[var(--st-wait)]")}>
          {entry.files.length ? <FileIcon size={14} aria-hidden="true" /> : <WarningIcon size={14} weight="bold" aria-hidden="true" />}
          {entry.files.length ? entry.files.join(", ") : "File missing"}
          {!entry.files.length && entry.counts && (
            <button type="button" onClick={() => ops.open({ lineId: line.def.id, mode: "edit", entryId: entry.id })} className="ml-6 inline-flex min-h-24 items-center font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4">Add file</button>
          )}
        </span>
      )}
      {!entry.counts && <span className="body-caption text-[var(--st-wait)]">Stopped counting after a template change. The total leaves it out.</span>}
      {entry.note && (zero || line.def.shape === "massDistance") && !editingNote && <span className="body-caption text-[var(--color-text-secondary)]">{entry.note}</span>}
      {zero && !entry.note && !editingNote && (
        <button type="button" onClick={() => ops.setNoteFor(line.def.id)} className="inline-flex min-h-24 items-center self-start body-caption font-medium text-[var(--color-text-interaction-primary)] underline underline-offset-4">Add note</button>
      )}
      {editingNote && <NoteEditor initial={entry.note} onCancel={() => ops.setNoteFor(null)} onSave={(note) => ops.saveNote(line, note)} />}
    </div>
  );
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState(initial);
  return (
    <div className="flex flex-col gap-6 pt-4 sm:flex-row sm:items-center">
      <Input aria-label="Note" value={note} autoFocus onChange={(e) => setNote(e.target.value)} placeholder="Why there is nothing to record" className="sm:max-w-[360px]" />
      <span className="flex gap-6">
        <Button size="small" variant="primary" onClick={() => onSave(note)}>Save note</Button>
        <Button size="small" variant="weak" onClick={onCancel}>Cancel</Button>
      </span>
    </div>
  );
}

function InlineLedger({ line, ops, batchCode, dryFeedstockT }: { line: PrototypeLine; ops: LineOps; batchCode: string; dryFeedstockT: number }) {
  const { def } = line;
  const kind = lineCase(line);
  const source = recordsSource(line);
  const hasSource = source.kind === "records";
  const gap = hasSource && source.value == null;
  const entries = line.entries.filter((e) => e.kind === "value" || !line.values.length);
  const entriesSum = line.values.reduce((sum, e) => sum + entryAmount(def, e), 0);
  const [showDescription, setShowDescription] = useState(false);
  const upstream = openLabel(line);
  const add = () => ops.open({ lineId: def.id, mode: "add" });
  const refusal = nothingToRecordRefusal(line);
  const showOnGap = OFFER_ENTRY_ON_RECORDS_GAP || !gap;

  if (line.state === "needsSetup") {
    return (
      <div className="flex flex-col gap-8 pt-4 md:pl-[30px]">
        <p className="body-small text-[var(--color-text-secondary)]">noma cannot fill this template line yet. An admin sets it up in the template review. Nothing to do here for now.</p>
        <Description def={def} open={showDescription} onToggle={() => setShowDescription((v) => !v)} />
      </div>
    );
  }

  // Buttons under the ledger, most useful first.
  const buttons: ReactNode[] = [];
  const upstreamLink = upstream && source.kind === "records" && (
    <Link key="open" href={source.href} className={buttonVariants({ size: "small", variant: gap ? "primary" : "weak" })}>{upstream}</Link>
  );
  if (line.state === "needsReview") {
    buttons.push(<Button key="confirm" size="small" variant="primary" onClick={() => ops.confirm(def.id)}>Confirm</Button>);
    buttons.push(<Button key="again" size="small" variant="weak" onClick={() => ops.open({ lineId: def.id, mode: "again" })}>Enter again</Button>);
  } else if (kind === "R") {
    if (upstreamLink) buttons.push(upstreamLink);
  } else if (kind === "S") {
    if (line.values[0]) buttons.push(<Button key="edit" size="small" variant="primary" onClick={() => ops.open({ lineId: def.id, mode: "edit", entryId: line.values[0].id })}>Edit entry</Button>);
    else buttons.push(<Button key="add" size="small" variant="primary" onClick={add}>Add entry</Button>);
  } else {
    if (line.state === "missingEvidence") {
      const missing = line.values.find((e) => !e.files.length);
      if (missing) buttons.push(<Button key="file" size="small" variant="primary" onClick={() => ops.open({ lineId: def.id, mode: "edit", entryId: missing.id })}>Add file</Button>);
    }
    if (gap && upstreamLink) buttons.push(upstreamLink);
    if (showOnGap) buttons.push(<Button key="add" size="small" variant={kind === "A" ? "primary" : "weak"} onClick={add}>Add entry</Button>);
    if (!gap && upstreamLink && kind !== "Z") buttons.push(upstreamLink);
  }
  if (kind !== "Z" && kind !== "R" && !refusal && line.state !== "needsReview") {
    buttons.push(<Button key="nothing" size="small" variant="weak" onClick={() => ops.nothing(line)}><NumberCircleZeroIcon size={16} aria-hidden="true" />Nothing to record</Button>);
  }

  const entriesLabel = def.rule === "none" ? "Entries" : hasSource ? (gap ? "Entries, on top of nothing from records" : "Entries, on top of the records") : def.rule === "single" ? "Entry, one per credit batch" : "Entries";
  const totalFigure = kind === "S" ? (line.values[0] ? entryText(def, line.values[0]) : "Not recorded") : line.totalText;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col">
        {hasSource && (
          <LedgerLine
            tone={gap ? "gap" : "records"}
            label={
              <span className="flex flex-col gap-2 body-small">
                <span className="font-medium">From records</span>
                <span className={cn("body-caption", gap ? "text-[var(--st-wait)]" : "text-[var(--color-text-secondary)]")}>
                  {gap ? recordsText(line) : `${formatNumber(source.count, 0)} ${source.count === 1 ? source.label.replace(/s$/, "") : source.label}. Fixed here, made on the source page.`}
                </span>
                {gap && def.rule === "additive" && <span className="body-caption text-[var(--color-text-secondary)]">{entryGuard(line)}</span>}
              </span>
            }
            figure={gap ? <span className="text-[var(--color-text-tertiary)]">Not recorded</span> : <span className="font-medium">{formatFigure(source.value ?? 0, def.unit)}</span>}
            actions={null}
          />
        )}
        {kind === "A" && (
          <LedgerLine label={<span className="body-small text-[var(--color-text-secondary)]">No records source. Only entries fill this line.</span>} />
        )}
        {def.rule !== "none" ? (
          <>
            <LedgerLine
              op={hasSource ? "+" : undefined}
              tone="entries"
              label={<span className="body-small font-medium">{entriesLabel}</span>}
              figure={def.shape === "gas" ? null : line.values.length ? <span className="text-[var(--acc-infra-ink)]">{formatFigure(entriesSum, def.unit)}</span> : line.nothing ? `0 ${def.unit}` : <span className="text-[var(--color-text-tertiary)]">None</span>}
            />
            {entries.map((entry) => (
              <LedgerLine
                key={entry.id}
                tone="entries"
                className="[&>div:first-child>div]:pl-16 md:[&>div:first-child>div]:pl-24"
                label={<EntryLabel line={line} entry={entry} ops={ops} />}
                figure={entry.kind === "nothing" ? <span className="text-[var(--color-text-secondary)]">{`0 ${def.unit}`}</span> : <span className={cn(!entry.counts && "text-[var(--color-text-tertiary)] line-through")}>{def.shape === "gas" ? entryText(def, entry) : formatFigure(entryAmount(def, entry), def.unit)}</span>}
                date={entry.date}
                actions={<EntryMenu line={line} entry={entry} ops={ops} />}
              />
            ))}
          </>
        ) : (
          <LedgerLine op="+" label={<span className="body-small text-[var(--color-text-secondary)]">{entriesText(line)}. Filled from records only.</span>} figure={<span className="text-[var(--color-text-tertiary)]">None</span>} />
        )}
        {kind !== "S" && (
          <LedgerLine
            op={hasSource || line.values.length > 1 ? "=" : undefined}
            className="mt-4 border-t border-[var(--color-border-primary)] pt-8"
            label={<span className="body-small font-medium">Total</span>}
            figure={<span className={cn("font-medium", line.total == null && kind !== "Z" && "text-[var(--color-text-tertiary)]")}>{totalFigure}</span>}
          />
        )}
      </div>

      {kind === "Z" && <p className="body-caption text-[var(--color-text-secondary)] md:pl-[30px]">Sent to Isometric as 0 for this line, with no file. The note stays in noma.</p>}
      {kind === "S" && def.shape === "gas" && (
        <p className="body-caption text-[var(--color-text-secondary)] md:pl-[30px]">{`Dry feedstock in ${batchCode}: ${formatNumber(dryFeedstockT)} t. Mass flow = dry feedstock × (36,792 t / 17,520 t).`}</p>
      )}
      <div className="flex flex-wrap items-center gap-8 md:pl-[30px]">
        {buttons}
      </div>
      <div className="md:pl-[30px]">
        <Description def={def} open={showDescription} onToggle={() => setShowDescription((v) => !v)} />
      </div>
    </div>
  );
}

function Description({ def, open, onToggle }: { def: PrototypeLine["def"]; open: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <DisclosureButton open={open} onToggle={onToggle}>Line description</DisclosureButton>
      {open && <p className="max-w-[72ch] body-small whitespace-pre-line text-[var(--color-text-secondary)]">{def.description}</p>}
    </div>
  );
}
