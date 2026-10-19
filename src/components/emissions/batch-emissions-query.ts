/**
 * The batch page's line filter and sort, in the URL (`lines`, `lsort`) next to
 * the overview's own keys, so the pager keeps both when it walks batches and
 * the breadcrumb returns to the filtered overview.
 */
"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";
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

/** The line keys to carry onto another batch's page. */
export function lineQueryParams(filter: LineFilter | null, sort: LineSort): URLSearchParams {
  const params = new URLSearchParams();
  if (filter) params.set("lines", filter);
  if (sort !== "template") params.set("lsort", sort);
  return params;
}
