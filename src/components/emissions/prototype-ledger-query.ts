/**
 * PROTOTYPE (epic #1058 PR 3, throwaway branch `prototype/emissions-variants`).
 *
 * The Emissions overview's filter and sort, kept in the URL (nuqs, like the
 * other app lists) so a filtered view is shareable and browser back restores
 * it. The batch detail route reads the same keys to walk previous and next
 * batches in the overview's order.
 *
 * URL keys
 *   overview: q (batch code search), status (open | done | files | review),
 *             period (month | 3m | 6m | year | custom), from, to (YYYY-MM,
 *             custom range only), sort (period | open | code), dir (asc | desc)
 *   detail:   lines (open | missing | review | notRecorded | done),
 *             lsort (template | state | total | last)
 *   both:     variant, facility
 */
"use client";

import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useSearchParams } from "next/navigation";
import { stateCounts } from "./prototype-emissions-data";
import type { BatchView } from "./prototype-emissions-shared";

/* ---------- overview keys ---------- */

export const BATCH_STATUS_FILTERS = ["open", "done", "files", "review"] as const;
export type BatchStatusFilter = (typeof BATCH_STATUS_FILTERS)[number];
export const BATCH_STATUS_LABELS: Record<BatchStatusFilter, string> = {
  open: "Lines open",
  done: "Done",
  files: "File missing",
  review: "Needs review",
};

export const PERIOD_PRESETS = ["month", "3m", "6m", "year", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  month: "This month",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  year: "This year",
  custom: "Custom range",
};

export const BATCH_SORTS = ["period", "open", "code"] as const;
export type BatchSort = (typeof BATCH_SORTS)[number];
export type SortDir = "asc" | "desc";
const DEFAULT_DIR: Record<BatchSort, SortDir> = { period: "desc", open: "desc", code: "desc" };

const overviewParsers = {
  q: parseAsString.withDefault("").withOptions({ history: "replace" }),
  status: parseAsStringLiteral(BATCH_STATUS_FILTERS),
  period: parseAsStringLiteral(PERIOD_PRESETS),
  from: parseAsString,
  to: parseAsString,
  sort: parseAsStringLiteral(BATCH_SORTS).withDefault("period"),
  dir: parseAsStringLiteral(["asc", "desc"] as const),
};

/* ---------- detail keys ---------- */

export const LINE_FILTERS = ["open", "missing", "review", "notRecorded", "done"] as const;
export type LineFilter = (typeof LINE_FILTERS)[number];
export const LINE_SORTS = ["template", "state", "total", "last"] as const;
export type LineSort = (typeof LINE_SORTS)[number];
export const LINE_SORT_LABELS: Record<LineSort, string> = {
  template: "Template order",
  state: "State",
  total: "Total",
  last: "Last entry",
};

const detailParsers = {
  lines: parseAsStringLiteral(LINE_FILTERS),
  lsort: parseAsStringLiteral(LINE_SORTS).withDefault("template"),
};

const OVERVIEW_KEYS = Object.keys(overviewParsers);
const DETAIL_KEYS = Object.keys(detailParsers);
const CARRIED_KEYS = ["variant", "facility"];

/** Overview filter and sort from the URL. Changes push history, search replaces it. */
export function useLedgerQuery() {
  const [query, setQuery] = useQueryStates(overviewParsers, { history: "push", scroll: false });
  const dir: SortDir = query.dir ?? DEFAULT_DIR[query.sort];
  const toggleSort = (sort: BatchSort) =>
    void setQuery(sort === query.sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort, dir: null });
  const clear = () => void setQuery({ q: null, status: null, period: null, from: null, to: null });
  const hasFilters = !!(query.q || query.status || query.period);
  return { query, dir, setQuery, toggleSort, clear, hasFilters };
}

/** Detail line filter and sort from the URL. */
export function useLineQuery() {
  const [query, setQuery] = useQueryStates(detailParsers, { history: "push", scroll: false });
  return { query, setQuery };
}

/**
 * Emissions links. They carry `variant`, `facility` and the overview's filter
 * and sort, so back to the overview keeps the filter and prev/next follows it.
 * `keepLines` also carries the detail's line filter and sort (prev/next).
 */
export function useLedgerHref() {
  const searchParams = useSearchParams();
  return (batchId?: string, { keepLines = false }: { keepLines?: boolean } = {}) => {
    const params = new URLSearchParams();
    for (const key of [...CARRIED_KEYS, ...OVERVIEW_KEYS, ...(keepLines ? DETAIL_KEYS : [])]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return `/emissions${batchId ? `/${batchId}` : ""}${query ? `?${query}` : ""}`;
  };
}

/* ---------- pure filtering and sorting ---------- */

const TODAY_MONTH = new Date().toISOString().slice(0, 7);

function shiftMonth(month: string, by: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
}

/** Inclusive month range for a period preset; null bounds are open. */
export function periodRange(period: PeriodPreset | null, from: string | null, to: string | null): [string | null, string | null] {
  switch (period) {
    case "month": return [TODAY_MONTH, TODAY_MONTH];
    case "3m": return [shiftMonth(TODAY_MONTH, -2), TODAY_MONTH];
    case "6m": return [shiftMonth(TODAY_MONTH, -5), TODAY_MONTH];
    case "year": return [`${TODAY_MONTH.slice(0, 4)}-01`, TODAY_MONTH];
    case "custom": return [from || null, to || null];
    default: return [null, null];
  }
}

export interface BatchSummary {
  view: BatchView;
  counts: ReturnType<typeof stateCounts>;
  open: number;
  filesMissing: number;
  review: number;
}

export function summarize(view: BatchView): BatchSummary {
  const counts = stateCounts(view.lines);
  return { view, counts, open: view.open.length, filesMissing: counts.missingEvidence, review: counts.needsReview };
}

export function matchesStatus(summary: BatchSummary, status: BatchStatusFilter): boolean {
  switch (status) {
    case "open": return summary.open > 0;
    case "done": return summary.open === 0;
    case "files": return summary.filesMissing > 0;
    case "review": return summary.review > 0;
  }
}

type OverviewQuery = ReturnType<typeof useLedgerQuery>["query"];

/** Search and period only: the set the KPI tiles count over. */
export function facetBatches(batches: BatchView[], query: OverviewQuery): BatchSummary[] {
  const [lo, hi] = periodRange(query.period, query.from, query.to);
  const needle = query.q.trim().toLowerCase();
  return batches
    .filter(({ batch }) => {
      const month = batch.startDate.slice(0, 7);
      if (lo && month < lo) return false;
      if (hi && month > hi) return false;
      return !needle || batch.code.toLowerCase().includes(needle);
    })
    .map(summarize);
}

export function sortBatches(rows: BatchSummary[], sort: BatchSort, dir: SortDir): BatchSummary[] {
  const sign = dir === "asc" ? 1 : -1;
  const byPeriod = (a: BatchSummary, b: BatchSummary) => a.view.batch.startDate.localeCompare(b.view.batch.startDate);
  return [...rows].sort((a, b) => {
    if (sort === "open") return sign * (a.open - b.open) || -byPeriod(a, b);
    if (sort === "code") return sign * a.view.batch.code.localeCompare(b.view.batch.code);
    return sign * byPeriod(a, b);
  });
}

/** The overview's rows: search, period, status, then sort. */
export function ledgerRows(batches: BatchView[], query: OverviewQuery, dir: SortDir): BatchSummary[] {
  const facet = facetBatches(batches, query);
  const filtered = query.status ? facet.filter((row) => matchesStatus(row, query.status!)) : facet;
  return sortBatches(filtered, query.sort, dir);
}
