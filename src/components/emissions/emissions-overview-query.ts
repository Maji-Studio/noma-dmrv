/**
 * The Emissions overview's filter and sort, kept in the URL (nuqs, #841) so a
 * filtered view is shareable and browser back restores it. The batch detail
 * route carries the same keys to return to the filtered overview and to walk
 * previous and next batches in the overview's order.
 *
 * URL keys: q (batch code search), status (open | done | files | review),
 * period (month | 3m | 6m | year | custom), from, to (YYYY-MM, custom range
 * only), sort (period | open | code), dir (asc | desc).
 * No "use client": the pure helpers also run on the server.
 */
import { useQueryStates } from "nuqs";
// Parsers from nuqs/server: the "nuqs" entry is a client module, so calling its
// parsers at module scope breaks server components that import these helpers.
import { parseAsString, parseAsStringLiteral } from "nuqs/server";
import type { FacilityEmissionsOverviewBatch } from "@/hooks/use-emissions-overview";
import { EMISSION_LINE_STATE_LABELS } from "@/lib/certification/emission-lines";

export const EMISSIONS_PATH = "/emissions";

export const BATCH_STATUS_FILTERS = ["open", "done", "files", "review"] as const;
export type BatchStatusFilter = (typeof BATCH_STATUS_FILTERS)[number];
export const BATCH_STATUS_LABELS: Record<BatchStatusFilter, string> = {
  open: "Lines open",
  done: "Done",
  files: "File missing",
  review: EMISSION_LINE_STATE_LABELS.needsReview,
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
/** How many months before the current one each rolling preset reaches back. */
const ROLLING_MONTHS_BACK = { "3m": 2, "6m": 5 } as const;
/** "YYYY-MM" out of an ISO date. */
export const MONTH_PREFIX_LENGTH = 7;
/** "YYYY" out of an ISO date. */
const YEAR_PREFIX_LENGTH = 4;

export const BATCH_SORTS = ["period", "open", "code"] as const;
export type BatchSort = (typeof BATCH_SORTS)[number];
export const BATCH_SORT_LABELS: Record<BatchSort, string> = {
  period: "Period",
  open: "Open lines",
  code: "Credit batch",
};
export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];
const DEFAULT_SORT: BatchSort = "period";
const DEFAULT_DIR: Record<BatchSort, SortDir> = { period: "desc", open: "desc", code: "desc" };

const overviewParsers = {
  q: parseAsString.withDefault("").withOptions({ history: "replace" }),
  status: parseAsStringLiteral(BATCH_STATUS_FILTERS),
  period: parseAsStringLiteral(PERIOD_PRESETS),
  from: parseAsString,
  to: parseAsString,
  sort: parseAsStringLiteral(BATCH_SORTS).withDefault(DEFAULT_SORT),
  dir: parseAsStringLiteral(SORT_DIRS),
};

/** The URL keys the overview owns; links into a batch carry these. */
export const EMISSIONS_OVERVIEW_QUERY_KEYS = Object.keys(overviewParsers) as (keyof typeof overviewParsers)[];

/** The overview query with the sort direction resolved. */
export interface EmissionsOverviewQuery {
  q: string;
  status: BatchStatusFilter | null;
  period: PeriodPreset | null;
  from: string | null;
  to: string | null;
  sort: BatchSort;
  dir: SortDir;
}

/** Overview filter and sort from the URL. Changes push history; typing in search replaces it. */
export function useEmissionsOverviewQuery() {
  const [raw, setQuery] = useQueryStates(overviewParsers, { history: "push", scroll: false });
  const query: EmissionsOverviewQuery = { ...raw, dir: raw.dir ?? DEFAULT_DIR[raw.sort] };
  const toggleSort = (sort: BatchSort) =>
    void setQuery(sort === query.sort ? { dir: query.dir === "asc" ? "desc" : "asc" } : { sort, dir: null });
  const clear = () => void setQuery({ q: null, status: null, period: null, from: null, to: null });
  const hasFilters = !!(query.q || query.status || query.period);
  return { query, setQuery, toggleSort, clear, hasFilters };
}

export type SetEmissionsOverviewQuery = ReturnType<typeof useEmissionsOverviewQuery>["setQuery"];

/** What an Emissions link carries: the overview query and the facility. */
export type EmissionsHrefQuery = Partial<EmissionsOverviewQuery> & { facility?: string | null };

function queryParams(query: EmissionsHrefQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.facility) params.set("facility", query.facility);
  if (query.q?.trim()) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.period) params.set("period", query.period);
  if (query.period === "custom" && query.from) params.set("from", query.from);
  if (query.period === "custom" && query.to) params.set("to", query.to);
  const sort = query.sort ?? DEFAULT_SORT;
  if (sort !== DEFAULT_SORT) params.set("sort", sort);
  if (query.dir && query.dir !== DEFAULT_DIR[sort]) params.set("dir", query.dir);
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** `/emissions` with the facility and the overview's filter and sort; defaults are left out. */
export function emissionsOverviewHref(query: EmissionsHrefQuery = {}): string {
  return withQuery(EMISSIONS_PATH, queryParams(query));
}

/** A credit batch's emissions page, carrying the overview's filter and sort. */
export function emissionsBatchHref(creditBatchId: string, query: EmissionsHrefQuery = {}): string {
  return withQuery(`${EMISSIONS_PATH}/${creditBatchId}`, queryParams(query));
}

/* ---------- pure filtering and sorting ---------- */

function shiftMonth(month: string, by: number): string {
  // UTC arithmetic only shifts a calendar month that is already resolved.
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, MONTH_PREFIX_LENGTH);
}

/**
 * Inclusive YYYY-MM range for a period preset; null bounds are open.
 * `today` is the facility's calendar day (YYYY-MM-DD), so "This month" is the facility's month.
 */
export function periodRange(
  query: Pick<EmissionsOverviewQuery, "period" | "from" | "to">,
  today: string,
): [string | null, string | null] {
  const current = today.slice(0, MONTH_PREFIX_LENGTH);
  switch (query.period) {
    case "month": return [current, current];
    case "3m":
    case "6m": return [shiftMonth(current, -ROLLING_MONTHS_BACK[query.period]), current];
    case "year": return [`${current.slice(0, YEAR_PREFIX_LENGTH)}-01`, current];
    case "custom": return [query.from || null, query.to || null];
    default: return [null, null];
  }
}

export function matchesStatus(batch: FacilityEmissionsOverviewBatch, status: BatchStatusFilter): boolean {
  const counts = batch.lineCounts;
  switch (status) {
    case "open": return counts.open > 0;
    case "done": return counts.total > 0 && counts.open === 0;
    case "files": return counts.fileMissing > 0;
    case "review": return counts.needsReview > 0;
  }
}

/** A batch overlaps the range when its period touches any month in it. */
function inPeriod(batch: FacilityEmissionsOverviewBatch, [lo, hi]: [string | null, string | null]): boolean {
  const start = batch.startDate.slice(0, MONTH_PREFIX_LENGTH);
  const end = batch.endDate ? batch.endDate.slice(0, MONTH_PREFIX_LENGTH) : null;
  if (hi && start > hi) return false;
  if (lo && end && end < lo) return false;
  return true;
}

/** Search and period only: the set the KPI tiles count over. */
export function facetBatches(
  batches: readonly FacilityEmissionsOverviewBatch[],
  query: Pick<EmissionsOverviewQuery, "q" | "period" | "from" | "to">,
  today: string,
): FacilityEmissionsOverviewBatch[] {
  const range = periodRange(query, today);
  const needle = query.q.trim().toLowerCase();
  return batches.filter((batch) => inPeriod(batch, range) && (!needle || batch.code.toLowerCase().includes(needle)));
}

export function sortBatches(
  batches: readonly FacilityEmissionsOverviewBatch[],
  sort: BatchSort,
  dir: SortDir,
): FacilityEmissionsOverviewBatch[] {
  const sign = dir === "asc" ? 1 : -1;
  const byPeriod = (a: FacilityEmissionsOverviewBatch, b: FacilityEmissionsOverviewBatch) =>
    a.startDate.localeCompare(b.startDate) || a.code.localeCompare(b.code);
  return [...batches].sort((a, b) => {
    if (sort === "open") return sign * (a.lineCounts.open - b.lineCounts.open) || -byPeriod(a, b);
    if (sort === "code") return sign * a.code.localeCompare(b.code, undefined, { numeric: true });
    return sign * byPeriod(a, b);
  });
}

/** The overview's rows: search, period, state, then sort. */
export function filterAndSortBatches(
  batches: readonly FacilityEmissionsOverviewBatch[],
  query: EmissionsOverviewQuery,
  today: string,
): FacilityEmissionsOverviewBatch[] {
  const facet = facetBatches(batches, query, today);
  const { status } = query;
  const filtered = status ? facet.filter((batch) => matchesStatus(batch, status)) : facet;
  return sortBatches(filtered, query.sort, query.dir);
}
