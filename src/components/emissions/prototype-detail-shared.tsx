/**
 * PROTOTYPE (epic #1058 PR 3). What every batch detail variant (C1, C2, C3)
 * shares. Layout stays in each variant file; import these instead of
 * re-deriving them.
 *
 * Shared detail API
 *
 *   useBatchDetail(data, batchId) → BatchDetail
 *     data comes from usePrototypeEmissions(); batchId must be a known batch
 *     (prototype-variants.tsx renders "Credit batch not found" before any
 *     variant). Returns:
 *       view          BatchView: batch, all 15 lines, open lines
 *       lines         lines after the URL line filter and sort
 *       groups        [{ group, lines }] in template order, filtered; use when
 *                     grouped is true (sort is "template")
 *       grouped       true for the default template order
 *       filter        LineFilter | null (URL `lines`); setFilter(next | null)
 *       sort          LineSort (URL `lsort`, default "template"); setSort(next)
 *       counts        per chip: { all, open, missing, review, notRecorded, done }
 *       kpis          { open, total, filesMissing, entriesThisMonth, lastEntry }
 *       sheet         the entry sheet controller (useEntrySheet); render
 *                     <EntrySheet sheet={detail.sheet} batches={data.batches} />
 *       actions       openSheet(lineId, mode, entryId?), addEntry(lineId, draft),
 *                     nothingToRecord(lineId, note, date), confirm(lineId).
 *                     All write to the in-memory stub store and toast.
 *
 *   <DetailTopBar view />          breadcrumb (back keeps the overview filter)
 *                                  plus <BatchPager>.
 *   <BatchPager batchId batches /> previous and next credit batch in the
 *                                  overview's filter and sort, "3 of 12", and
 *                                  the [ and ] keys (never while typing).
 *   <DetailKpiStrip detail />      4 compact cells: Lines open and Files missing
 *                                  apply their chip; entries this month; last
 *                                  entry date.
 *   <LineStateChips detail />      All, Open, File missing, Needs review, Not
 *                                  recorded, Done, with counts.
 *   <LineSortSelect detail />      Template order, State, Total, Last entry.
 *   <NoLinesMatch detail />        EmptyState for a chip with no lines.
 *   lineMatches(line, filter), sortLines(lines, sort), lastEntryDate(line)
 *
 * Everything else a variant needs (LineStateBadge, LineDetails, ReviewBlock,
 * EntrySheet, nextAction, NeedsSetupText, BatchSheetEmissionsPanel) lives in
 * prototype-emissions-shared.tsx.
 */
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon, FunnelSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, DataTable, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  OPEN_STATES,
  prototypeActions,
  type EntryDraft,
  type PrototypeLine,
  type PrototypeLineState,
} from "./prototype-emissions-data";
import { EmissionsBreadcrumb, useEntrySheet, type BatchView, type SheetMode, type usePrototypeEmissions } from "./prototype-emissions-shared";
import {
  LINE_SORTS,
  LINE_SORT_LABELS,
  ledgerRows,
  sortBatches,
  summarize,
  useLedgerHref,
  useLedgerQuery,
  useLineQuery,
  type LineFilter,
  type LineSort,
} from "./prototype-ledger-query";

type Data = ReturnType<typeof usePrototypeEmissions>;
const THIS_MONTH = new Date().toISOString().slice(0, 7);
const THIS_MONTH_LABEL = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

/* ---------- filtering and sorting lines ---------- */

const DONE_STATES: readonly PrototypeLineState[] = ["filled", "nothingToRecord", "confirmedZero"];

export function lineMatches(line: PrototypeLine, filter: LineFilter | null): boolean {
  switch (filter) {
    case null: return true;
    case "open": return line.open;
    case "missing": return line.state === "missingEvidence";
    case "review": return line.state === "needsReview";
    case "notRecorded": return line.state === "empty";
    case "done": return DONE_STATES.includes(line.state);
  }
}

export function lastEntryDate(line: PrototypeLine): string | null {
  return line.entries.reduce<string | null>((latest, entry) => (!latest || entry.date > latest ? entry.date : latest), null);
}

/** Open states first (most urgent first), then done. */
const STATE_ORDER: readonly PrototypeLineState[] = [...OPEN_STATES, "nothingToRecord", "confirmedZero", "filled"];

export function sortLines(lines: PrototypeLine[], sort: LineSort): PrototypeLine[] {
  if (sort === "template") return lines;
  return [...lines].sort((a, b) => {
    if (sort === "state") return STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
    if (sort === "total") return (b.total ?? -1) - (a.total ?? -1);
    return (lastEntryDate(b) ?? "").localeCompare(lastEntryDate(a) ?? "");
  });
}

/* ---------- the hook ---------- */

export interface DetailKpis {
  open: number;
  total: number;
  filesMissing: number;
  entriesThisMonth: number;
  lastEntry: string | null;
}

export function useBatchDetail(data: Data, batchId: string) {
  const toast = useToast();
  const sheet = useEntrySheet();
  const { query, setQuery } = useLineQuery();
  const view = data.batches.find((b) => b.batch.id === batchId) as BatchView;
  const filter = query.lines;
  const sort = query.lsort;
  const lines = sortLines(view.lines.filter((line) => lineMatches(line, filter)), sort);
  const groupNames = [...new Set(view.lines.map((line) => line.def.group))];
  const groups = groupNames
    .map((group) => ({ group, lines: lines.filter((line) => line.def.group === group) }))
    .filter((group) => group.lines.length > 0);
  const countOf = (f: LineFilter | null) => view.lines.filter((line) => lineMatches(line, f)).length;
  const counts = { all: view.lines.length, open: countOf("open"), missing: countOf("missing"), review: countOf("review"), notRecorded: countOf("notRecorded"), done: countOf("done") };
  const entries = view.lines.flatMap((line) => line.entries);
  const kpis: DetailKpis = {
    open: view.open.length,
    total: view.lines.length,
    filesMissing: counts.missing,
    entriesThisMonth: entries.filter((entry) => entry.date.startsWith(THIS_MONTH)).length,
    lastEntry: entries.reduce<string | null>((latest, entry) => (!latest || entry.date > latest ? entry.date : latest), null),
  };
  const nameOf = (lineId: string) => view.lines.find((line) => line.def.id === lineId)?.def.name ?? lineId;
  const actions = {
    openSheet: (lineId: string, mode: SheetMode, entryId?: string) => sheet.show({ batchId: view.batch.id, lineId, mode, entryId }),
    addEntry: (lineId: string, draft: EntryDraft) => {
      prototypeActions.addEntry(view.batch, lineId, draft);
      toast.success(`Entry saved on ${nameOf(lineId)}.`);
    },
    nothingToRecord: (lineId: string, note: string, date: string) => {
      prototypeActions.addEntry(view.batch, lineId, { kind: "nothing", date, files: [], note });
      toast.success(`${nameOf(lineId)} marked nothing to record.`);
    },
    confirm: (lineId: string) => {
      prototypeActions.confirm(view.batch, lineId);
      toast.success(`${nameOf(lineId)} confirmed.`);
    },
  };
  return {
    data,
    view,
    lines,
    groups,
    grouped: sort === "template",
    filter,
    setFilter: (next: LineFilter | null) => void setQuery({ lines: next }),
    sort,
    setSort: (next: LineSort) => void setQuery({ lsort: next }),
    counts,
    kpis,
    sheet,
    actions,
  };
}
export type BatchDetail = ReturnType<typeof useBatchDetail>;

/* ---------- navigation ---------- */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Previous and next credit batch in the overview's current filter and sort. */
export function BatchPager({ batchId, batches }: { batchId: string; batches: BatchView[] }) {
  const router = useRouter();
  const href = useLedgerHref();
  const { query, dir } = useLedgerQuery();
  const filtered = ledgerRows(batches, query, dir);
  const inFilter = filtered.some((row) => row.view.batch.id === batchId);
  // A batch outside the filter (a deep link) walks the whole list instead.
  const list = inFilter ? filtered : sortBatches(batches.map(summarize), query.sort, dir);
  const index = list.findIndex((row) => row.view.batch.id === batchId);
  const prev = index > 0 ? list[index - 1].view.batch : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1].view.batch : null;
  const prevHref = prev ? href(prev.id, { keepLines: true }) : null;
  const nextHref = next ? href(next.id, { keepLines: true }) : null;

  // External-system sync: a window key listener for [ and ].
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector("[role=dialog]")) return;
      if (event.key === "[" && prevHref) router.push(prevHref, { scroll: false });
      if (event.key === "]" && nextHref) router.push(nextHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const link = "inline-flex min-h-44 min-w-44 items-center justify-center gap-6 px-8 body-small font-medium text-[var(--color-text-interaction-primary)] hover:bg-[var(--color-surface-medium)]";
  const disabled = "inline-flex min-h-44 min-w-44 items-center justify-center gap-6 px-8 body-small text-[var(--color-text-tertiary)]";
  return (
    <nav aria-label="Credit batches" className="flex items-center gap-4">
      {prev && prevHref ? (
        <Link href={prevHref} scroll={false} className={link} aria-label={`Previous credit batch, ${prev.code}`} aria-keyshortcuts="[">
          <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
          <span className="hidden sm:inline">{prev.code}</span>
        </Link>
      ) : (
        <span className={disabled} aria-hidden="true"><ArrowLeftIcon size={16} weight="bold" /></span>
      )}
      <span className="whitespace-nowrap px-4 body-caption tabular-nums text-[var(--color-text-secondary)]" title={inFilter ? "Position in the filtered list" : "Not in the overview filter, so this walks all credit batches"}>
        {`${index + 1} of ${list.length}${inFilter ? "" : " (all)"}`}
      </span>
      {next && nextHref ? (
        <Link href={nextHref} scroll={false} className={link} aria-label={`Next credit batch, ${next.code}`} aria-keyshortcuts="]">
          <span className="hidden sm:inline">{next.code}</span>
          <ArrowRightIcon size={16} weight="bold" aria-hidden="true" />
        </Link>
      ) : (
        <span className={disabled} aria-hidden="true"><ArrowRightIcon size={16} weight="bold" /></span>
      )}
    </nav>
  );
}

/** Breadcrumb (back to the filtered overview) and the pager on one row. */
export function DetailTopBar({ view, batches }: { view: BatchView; batches: BatchView[] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-4">
      <EmissionsBreadcrumb code={view.batch.code} />
      <BatchPager batchId={view.batch.id} batches={batches} />
    </div>
  );
}

/* ---------- KPI strip ---------- */

/** Four compact cells in one panel: short, so it never crowds the table. */
export function DetailKpiStrip({ detail, className }: { detail: BatchDetail; className?: string }) {
  const { kpis, filter, setFilter } = detail;
  const cells: { label: string; value: string; detail: string; filter?: LineFilter }[] = [
    { label: "Lines open", value: `${kpis.open}`, detail: `of ${kpis.total} lines`, filter: "open" },
    { label: "Files missing", value: `${kpis.filesMissing}`, detail: kpis.filesMissing === 1 ? "line" : "lines", filter: "missing" },
    { label: "Entries this month", value: `${kpis.entriesThisMonth}`, detail: THIS_MONTH_LABEL },
    { label: "Last entry", value: kpis.lastEntry ? formatDate(kpis.lastEntry) : "None", detail: "" },
  ];
  return (
    <div className={cn("grid grid-cols-2 [border:var(--panel-border)] bg-[var(--paper)] lg:grid-cols-4", className)}>
      {cells.map((cell, index) => {
        const active = cell.filter && filter === cell.filter;
        const body = (
          <>
            <span className="body-caption text-[var(--color-text-secondary)]">{cell.label}</span>
            <span className="flex flex-wrap items-baseline gap-x-6">
              <span className={cn("body-large font-medium tabular-nums", active && "text-[var(--color-interaction)]")}>{cell.value}</span>
              {cell.detail && <span className="body-caption text-[var(--color-text-tertiary)]">{cell.detail}</span>}
            </span>
          </>
        );
        const edge = cn(
          "flex min-h-44 flex-col items-start gap-2 px-16 py-10 text-left",
          index % 2 === 0 && "[border-right:var(--row-divider)]",
          index < 2 && "[border-bottom:var(--row-divider)] lg:[border-bottom:none]",
          index === 1 && "lg:[border-right:var(--row-divider)]",
          index === 2 && "lg:[border-right:var(--row-divider)]",
        );
        return cell.filter ? (
          <button
            key={cell.label}
            type="button"
            aria-pressed={!!active}
            onClick={() => setFilter(active ? null : cell.filter!)}
            className={cn(edge, "hover:bg-[var(--row-hover-bg-solid)]", active && "[box-shadow:inset_0_-3px_0_var(--color-interaction)]")}
          >
            {body}
          </button>
        ) : (
          <div key={cell.label} className={edge}>{body}</div>
        );
      })}
    </div>
  );
}

/* ---------- state chips and sort ---------- */

const CHIPS: { filter: LineFilter | null; label: string; count: keyof BatchDetail["counts"] }[] = [
  { filter: null, label: "All", count: "all" },
  { filter: "open", label: "Open", count: "open" },
  { filter: "missing", label: "File missing", count: "missing" },
  { filter: "review", label: "Needs review", count: "review" },
  { filter: "notRecorded", label: "Not recorded", count: "notRecorded" },
  { filter: "done", label: "Done", count: "done" },
];

/** The RangeToggle recipe as filter chips; scrolls inside its own row on phones. */
export function LineStateChips({ detail, className }: { detail: BatchDetail; className?: string }) {
  return (
    <div className={cn("-mx-16 overflow-x-auto px-16 sm:mx-0 sm:px-0", className)}>
      <div role="group" aria-label="Show lines" className="flex w-max border-[1.5px] border-[var(--clr-dark-purple-20)]">
        {CHIPS.map((chip, index) => {
          const active = detail.filter === chip.filter;
          const count = detail.counts[chip.count];
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={active}
              onClick={() => detail.setFilter(chip.filter)}
              className={cn(
                "inline-flex min-h-44 items-center gap-6 whitespace-nowrap px-12 body-caption font-medium transition-colors sm:min-h-[36px]",
                index < CHIPS.length - 1 && "border-r-[1.5px] border-[var(--clr-dark-purple-20)]",
                active ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                !active && count === 0 && "text-[var(--color-text-tertiary)]",
              )}
            >
              {chip.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LineSortSelect({ detail, className }: { detail: BatchDetail; className?: string }) {
  return (
    <DataTable.FilterSelect
      value={detail.sort}
      onChange={(event) => detail.setSort(event.target.value as LineSort)}
      aria-label="Sort lines"
      className={className}
    >
      {LINE_SORTS.map((sort) => <option key={sort} value={sort}>{`Sort: ${LINE_SORT_LABELS[sort].toLowerCase()}`}</option>)}
    </DataTable.FilterSelect>
  );
}

/** A chip with no lines: say which chip and how to widen it. */
export function NoLinesMatch({ detail }: { detail: BatchDetail }) {
  const label = CHIPS.find((chip) => chip.filter === detail.filter)?.label ?? "All";
  return (
    <EmptyState
      padding="sm"
      icon={<FunnelSimpleIcon size={32} />}
      title={`No lines in "${label}"`}
      description={`The ${label} filter hides all ${detail.counts.all} lines of ${detail.view.batch.code}.`}
      action={<Button variant="default" onClick={() => detail.setFilter(null)}>Show all lines</Button>}
    />
  );
}
