/**
 * Shared user-facing copy helpers.
 *
 * Keep missing-value language semantic. A missing recorded field is different
 * from a value the app cannot calculate, a setting that has not been chosen,
 * an empty collection, or a field that does not apply.
 */
export const MISSING_VALUE = {
  notRecorded: "Not recorded",
  notAvailable: "Not available",
  notApplicable: "Not applicable",
  none: "None",
  notSet: "Not set",
} as const;

const MISSING_VALUE_COPY = new Set<string>(Object.values(MISSING_VALUE));

/** Return whether a rendered value is one of the shared missing-value labels. */
export function isMissingValueCopy(value: unknown): boolean {
  return typeof value === "string" && MISSING_VALUE_COPY.has(value);
}

/**
 * Return the natural noun for a count.
 *
 * Pass an explicit plural for irregular nouns.
 */
export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}

/** Format a count with its natural singular or plural noun. */
export function formatCount(
  count: number,
  singular: string,
  plural?: string,
): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
