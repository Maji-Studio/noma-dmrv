/**
 * Above the line list: the KPI strip (Lines open and Files missing apply
 * their chip), the state chips with counts and the sort select.
 */
"use client";

import { DataTable } from "@/components/ui";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate } from "@/lib/format-utils";
import { EMISSION_LINE_STATE_LABELS } from "@/lib/certification/emission-lines";
import { cn } from "@/lib/utils";
import { LINE_SORTS, LINE_SORT_LABELS, type LineCounts, type LineFilter, type LineSort } from "./emission-line-display";

export interface BatchKpis {
  open: number;
  total: number;
  filesMissing: number;
  entriesThisMonth: number;
  /** When the last manual entry was recorded. */
  lastEntryAt: Date | null;
}

interface KpiCell { label: string; value: string; detail: string; filter?: LineFilter }

export function BatchKpiStrip({ kpis, filter, onFilter }: { kpis: BatchKpis; filter: LineFilter | null; onFilter: (next: LineFilter | null) => void }) {
  const cells: KpiCell[] = [
    { label: "Lines open", value: String(kpis.open), detail: `of ${kpis.total} lines`, filter: "open" },
    { label: "Files missing", value: String(kpis.filesMissing), detail: kpis.filesMissing === 1 ? "line" : "lines", filter: "missing" },
    { label: "Manual entries this month", value: String(kpis.entriesThisMonth), detail: "" },
    { label: "Last entry", value: kpis.lastEntryAt ? formatDate(kpis.lastEntryAt) : MISSING_VALUE.none, detail: "" },
  ];
  return (
    <div className="grid grid-cols-2 bg-[var(--paper)] [border:var(--panel-border)] lg:grid-cols-4">
      {cells.map((cell, index) => {
        const active = !!cell.filter && filter === cell.filter;
        const edge = cn(
          "flex min-h-44 flex-col items-start gap-2 px-16 py-10 text-left",
          index % 2 === 0 && "[border-right:var(--row-divider)]",
          index < 2 && "[border-bottom:var(--row-divider)] lg:[border-bottom:none]",
          index > 0 && index < cells.length - 1 && "lg:[border-right:var(--row-divider)]",
        );
        const body = (
          <>
            <span className="body-caption text-[var(--color-text-secondary)]">{cell.label}</span>
            <span className="flex flex-wrap items-baseline gap-x-6">
              <span className={cn("body-large font-medium tabular-nums", active && "text-[var(--color-interaction)]")}>{cell.value}</span>
              {cell.detail && <span className="body-caption text-[var(--color-text-tertiary)]">{cell.detail}</span>}
            </span>
          </>
        );
        const cellFilter = cell.filter;
        return cellFilter ? (
          <button
            key={cell.label}
            type="button"
            aria-pressed={active}
            onClick={() => onFilter(active ? null : cellFilter)}
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

export const LINE_CHIPS: { filter: LineFilter | null; label: string; count: keyof LineCounts }[] = [
  { filter: null, label: "All", count: "all" },
  { filter: "open", label: "Open", count: "open" },
  { filter: "missing", label: "File missing", count: "missing" },
  { filter: "review", label: EMISSION_LINE_STATE_LABELS.needsReview, count: "review" },
  { filter: "notRecorded", label: "Not recorded", count: "notRecorded" },
  { filter: "done", label: "Done", count: "done" },
];

export function lineChipLabel(filter: LineFilter | null): string | null {
  return filter ? (LINE_CHIPS.find((chip) => chip.filter === filter)?.label ?? null) : null;
}

interface LineToolbarProps {
  counts: LineCounts;
  filter: LineFilter | null;
  sort: LineSort;
  onFilter: (next: LineFilter | null) => void;
  onSort: (next: LineSort) => void;
}

export function LineToolbar({ counts, filter, sort, onFilter, onSort }: LineToolbarProps) {
  return (
    <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="-mx-16 overflow-x-auto px-16 sm:mx-0 sm:px-0">
        <div role="group" aria-label="Show lines" className="flex w-max border-[1.5px] border-[var(--clr-dark-purple-20)]">
          {LINE_CHIPS.map((chip, index) => {
            const active = filter === chip.filter;
            const count = counts[chip.count];
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={active}
                onClick={() => onFilter(chip.filter)}
                className={cn(
                  "inline-flex min-h-44 items-center gap-6 whitespace-nowrap px-12 body-caption font-medium transition-colors sm:min-h-[36px]",
                  index < LINE_CHIPS.length - 1 && "border-r-[1.5px] border-[var(--clr-dark-purple-20)]",
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
      <DataTable.FilterSelect value={sort} onChange={(event) => onSort(event.target.value as LineSort)} aria-label="Sort lines">
        {LINE_SORTS.map((option) => (
          <option key={option} value={option}>{`Sort: ${LINE_SORT_LABELS[option].toLowerCase()}`}</option>
        ))}
      </DataTable.FilterSelect>
    </div>
  );
}
