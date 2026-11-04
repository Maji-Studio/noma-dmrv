import { z } from "zod";

const uuidSchema = z.uuid();

/**
 * Most ids an exact-record list filter (`?ids=`) accepts. The list schemas
 * cap at it, and a link past it opens the plain list instead.
 */
export const EXACT_ID_FILTER_MAX = 100;

export interface ExactIdFilter {
  ids: string[];
  normalized: string | null;
  hadInvalidValues: boolean;
}

/**
 * Normalizes a comma-separated exact-record deep link before it reaches a
 * UUID-validated server action. Invalid/stale values are discarded and
 * duplicates collapse, so a hand-edited URL remains recoverable.
 */
export function parseExactIdFilter(value: string | null): ExactIdFilter {
  if (!value) {
    return { ids: [], normalized: null, hadInvalidValues: false };
  }

  const ids: string[] = [];
  let hadInvalidValues = false;
  for (const candidate of value.split(",").map((part) => part.trim())) {
    if (!uuidSchema.safeParse(candidate).success) {
      hadInvalidValues = true;
      continue;
    }
    const canonicalId = candidate.toLowerCase();
    if (!ids.includes(canonicalId)) ids.push(canonicalId);
  }

  return {
    ids,
    normalized: ids.length > 0 ? ids.join(",") : null,
    hadInvalidValues,
  };
}
