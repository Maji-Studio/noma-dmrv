/**
 * Feedstock-type filter state.
 *
 * The list toolbar owns the control and the KPI strip owns the cards, but they
 * are two siblings of the same page, so the selection lives in the URL rather
 * than in either component. Both read it through this hook, which keeps the
 * cards and the rows describing the same set of deliveries and makes a filtered
 * view shareable.
 */
"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useFeedstockTypeList } from "@/hooks/use-feedstock-types";

/** Query-string key for the active feedstock type. */
export const FEEDSTOCK_TYPE_FILTER_PARAM = "feedstockType";

/**
 * Selectable types for the filter, name-ordered and without the archived ones.
 *
 * The searchable entity-option endpoint caps its result at 50 rows in no
 * particular order, which is fine for a type-ahead and wrong for a dropdown an
 * operator scans, so the filter reads the full org list instead.
 */
export function useFeedstockTypeFilterOptions() {
  const { data } = useFeedstockTypeList();
  return data?.filter((feedstockType) => !feedstockType.archivedAt) ?? [];
}

export function useFeedstockTypeFilter() {
  const [param, setFeedstockTypeId] = useQueryState(
    FEEDSTOCK_TYPE_FILTER_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );

  return {
    /** Empty string when no type is selected, so it can drive a `<select>`. */
    feedstockTypeId: param ?? "",
    setFeedstockTypeId,
  };
}
