/**
 * Shared user-facing copy helpers.
 *
 * # The missing-value rule
 *
 * Name the situation, not the screen. There is one token per situation, and a
 * blank value takes the token that answers *why it is absent*:
 *
 * | Situation | Token | Means |
 * | --- | --- | --- |
 * | `notRecorded` | "Not recorded" | The operator could have entered this and did not. |
 * | `notAvailable` | "Not available" | The app cannot read or derive the value. |
 * | `notSet` | "Not set" | A setting, option, or relation nobody has chosen yet. |
 * | `none` | "None" | The value is a collection and the collection is empty. |
 * | `notApplicable` | "Not applicable" | The field does not apply to this record at all. |
 * | `notYetComputed` | "Not yet computed" | The app will produce this value once upstream work finishes. |
 *
 * Which token a **formatter** returns is decided by what its input is, not by
 * its unit. A formatter that receives a value an operator records (a mass, a
 * percentage, a date, a distance) returns `notRecorded` when that value is
 * null, and `notAvailable` when it receives a value it cannot parse. A
 * formatter that receives a value the app derives (CO₂e, aggregated tonnes,
 * file size) returns `notAvailable`, because there was never an operator to
 * record it.
 *
 * Never hand-write a missing-value string in a component, never invent a
 * seventh phrasing, and never use an en dash or em dash as a placeholder.
 */

/** The situations a missing value can name. One situation, one token. */
export type MissingValueSituation =
  | "notRecorded"
  | "notAvailable"
  | "notApplicable"
  | "none"
  | "notSet"
  | "notYetComputed";

/**
 * The rendered copy for each situation.
 *
 * These strings are load-bearing: Playwright specs and detail-panel presence
 * checks match them verbatim. Add a situation rather than reword one.
 */
export const MISSING_VALUE = {
  /** Operator omission: a field they could have filled and left blank. */
  notRecorded: "Not recorded",
  /** The app cannot read or derive it: a failed lookup, an unparseable stored value, a derived figure whose inputs are missing. */
  notAvailable: "Not available",
  /** The field does not apply to this record, so nobody will ever fill it. */
  notApplicable: "Not applicable",
  /** An empty collection. "None" is an answer, not a gap. */
  none: "None",
  /** A setting, option, or relation nobody has chosen yet. */
  notSet: "Not set",
  /** Exists upstream but is blocked or still pending, so the app has no figure yet. */
  notYetComputed: "Not yet computed",
} as const satisfies Record<MissingValueSituation, string>;

/** The rendered copy of any missing-value token. */
export type MissingValueCopy = (typeof MISSING_VALUE)[MissingValueSituation];

const SITUATION_BY_COPY: ReadonlyMap<string, MissingValueSituation> = new Map(
  (
    Object.entries(MISSING_VALUE) as Array<[MissingValueSituation, string]>
  ).map(([situation, copy]) => [copy, situation]),
);

/** Return the rendered copy for a situation. */
export function missingValueCopy(
  situation: MissingValueSituation,
): MissingValueCopy {
  return MISSING_VALUE[situation];
}

/**
 * Return the situation a rendered string names, or null when the string is not
 * one of the shared tokens. Use this instead of comparing against a literal.
 */
export function missingValueSituation(
  value: unknown,
): MissingValueSituation | null {
  if (typeof value !== "string") return null;
  return SITUATION_BY_COPY.get(value) ?? null;
}

/** Return whether a rendered value is one of the shared missing-value labels. */
export function isMissingValueCopy(value: unknown): boolean {
  return missingValueSituation(value) !== null;
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
