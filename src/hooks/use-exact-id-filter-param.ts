import { parseAsString, useQueryState } from "nuqs";
import { useEffect } from "react";
import { parseExactIdFilter } from "@/lib/exact-id-filter";

/**
 * The `?ids=` exact-record filter of a list. `ids` are the valid, de-duplicated
 * UUIDs; `normalized` is their canonical param value. A hand-edited param is
 * rewritten to the normalized form so the URL stays shareable.
 */
export function useExactIdFilterParam() {
  const [param, setParam] = useQueryState(
    "ids",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const { ids, normalized } = parseExactIdFilter(param);

  // Syncs the URL (an external system) with the normalized value.
  useEffect(() => {
    if (param && normalized !== param) {
      void setParam(normalized);
    }
  }, [normalized, param, setParam]);

  const clear = () => setParam(null);

  return { ids, normalized, clear };
}
