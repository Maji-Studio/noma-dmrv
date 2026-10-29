/**
 * The Emissions tab's line filter and sort, in the URL (`lines`, `lsort`) next to
 * the overview's own keys (and the credit batch page's `tab`, `focus`, `facility`,
 * which they never reuse), so the pager keeps both when it walks batches and
 * its link returns to the filtered Emissions list.
 */
"use client";

import { parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from "nuqs";
import { EMISSIONS_LIST_ORIGIN, EMISSIONS_LIST_ORIGIN_PARAM } from "./emissions-overview-query";
import { LINE_FILTERS, LINE_SORTS, type LineFilter, type LineSort } from "./emission-line-display";

const lineParsers = {
  lines: parseAsStringLiteral(LINE_FILTERS),
  lsort: parseAsStringLiteral(LINE_SORTS).withDefault("template"),
};

export function useBatchLineQuery() {
  const [query, setQuery] = useQueryStates(lineParsers, { history: "replace", scroll: false });
  return {
    filter: query.lines,
    sort: query.lsort,
    setFilter: (next: LineFilter | null) => void setQuery({ lines: next }),
    setSort: (next: LineSort) => void setQuery({ lsort: next === "template" ? null : next }),
  };
}

/** True when the Emissions tab was opened from the Emissions list, so it can walk that list's batches. */
export function useOpenedFromEmissionsList(): boolean {
  const [origin] = useQueryState(EMISSIONS_LIST_ORIGIN_PARAM, parseAsString);
  return origin === EMISSIONS_LIST_ORIGIN;
}

/** The line keys to carry onto another batch's page. */
export function lineQueryParams(filter: LineFilter | null, sort: LineSort): URLSearchParams {
  const params = new URLSearchParams();
  if (filter) params.set("lines", filter);
  if (sort !== "template") params.set("lsort", sort);
  return params;
}
