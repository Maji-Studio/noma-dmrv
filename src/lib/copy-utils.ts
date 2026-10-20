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
 * | `notSet` | "Not set" | A setting, option, or relation nobody has chosen yet. |
 * | `none` | "None" | The value is a collection and the collection is empty. |
 * | `notApplicable` | "Not applicable" | The field does not apply to this record at all. |
 * | `notYetComputed` | "Not yet computed" | The app will produce this value once upstream work finishes. |
 *
 * There is no catch-all for "the app has no value here". When no token fits,
 * say why in a few words where the code knows the reason ("No moisture
 * reading", "Unreadable date"), and leave a derived figure (a sum, an
 * estimate, a share) out instead of printing a placeholder. Never guess a
 * reason the code cannot know at that point.
 *
 * Which token a **formatter** returns is decided by what its input is, not by
 * its unit. A formatter that receives a value an operator records (a mass, a
 * percentage, a date, a distance) returns `notRecorded` when that value is
 * null, and a short reason when it cannot parse it. A formatter for a value
 * the app derives (CO₂e, aggregated tonnes, file size) takes a number only, so
 * its caller decides where the figure goes when there is none.
 *
 * Never hand-write a token in a component, never invent a new token, and
 * never use an en dash or em dash as a placeholder. The full rule is in
 * `docs/ux-writing.md`.
 */

/**
 * The outcome copy for a write that committed but whose follow-up read did
 * not. It says what the operator can rely on (the record is saved) and what
 * they cannot (what it now looks like). Never use it for a rollback: a write
 * that did not commit says so plainly instead (issue #769).
 */
export const SAVED_DETAILS_UNAVAILABLE =
  "The record was saved, but its details could not be loaded.";

/** The reason a stored date or date-time that will not parse shows in place of the value. */
export const UNREADABLE_DATE = "Unreadable date";

/** The reason a stored time of day that will not parse shows in place of the value. */
export const UNREADABLE_TIME = "Unreadable time";

/** What a value says when the read that should supply it failed. */
export const LOAD_FAILED = "Could not load";

/** An input or component whose unit Isometric leaves empty. */
export const ISOMETRIC_GIVES_NO_UNIT = "Isometric gives no unit";

/** What a registry record says when the ID noma saved no longer resolves on Isometric. */
export const NOT_FOUND_ON_ISOMETRIC = "Not found on Isometric";

/** A stock part or batch with no moisture reading to split or describe it by. */
export const NO_MOISTURE_READING = "No moisture reading";

/** A list cell whose facility lookup found no facility in the organisation. */
export const FACILITY_NOT_FOUND = "Facility not found";

/** Who made a change when the recorded user row is gone or carries no name. */
export const UNKNOWN_USER = "Unknown user";

/** The situations a missing value can name. One situation, one token. */
export type MissingValueSituation =
  | "notRecorded"
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

/** Shared reasons a formatter returns in place of a value, so presence checks still read them as a gap. */
const FORMATTER_REASONS: ReadonlySet<string> = new Set([UNREADABLE_DATE, UNREADABLE_TIME]);

/**
 * Return whether a rendered value is one of the shared missing-value labels,
 * or a shared formatter reason such as "Unreadable date".
 */
export function isMissingValueCopy(value: unknown): boolean {
  if (typeof value === "string" && FORMATTER_REASONS.has(value)) return true;
  return missingValueSituation(value) !== null;
}

/** Turn a snake_case enum value into a sentence case label: `in_transit` → "In transit". */
export function humanizeEnum(value: string): string {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
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
