/**
 * Pure GHG-statement reporting-window logic — the single source both the
 * create dialog's preview (client) and the empty-statement guard (server)
 * derive from, so operator and registry never disagree on which removals a
 * period contains.
 *
 * Isometric derives a statement's period start as the day *after* the previous
 * statement's end, and links every Removal whose completion date falls in
 * `[start, end_on]` (inclusive). The first statement has no prior end, so
 * Isometric anchors the start to the project start — represented here as a
 * `null` lower bound (no lower bound applied). See `POST /ghg_statements`
 * ("Submits a series of removals for verification"; request is only
 * `{ project_id, end_on }`).
 *
 * No I/O. Lexical `<`/`>` comparison is correct for `YYYY-MM-DD` strings.
 */

import { addDaysIso } from "@/lib/date-utils";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Years below this are keystroke artifacts, not chosen periods. An
 * `<input type="date">` fires a change for every digit of the year segment, so
 * typing "2028" emits "0002-01-31", "0020-01-31", "0202-01-31" on the way. Each
 * is a well-formed date that sorts before every existing period end, so judging
 * one against the overlap rule flashes an error contradicting what the operator
 * is still typing.
 */
const MIN_PERIOD_END_YEAR = 1000;

/**
 * The reporting-period start for a statement ending `endOn`: the day after the
 * latest existing period end strictly before `endOn`. `null` for the first
 * statement (Isometric anchors it to the project start).
 */
export function derivePeriodStart(
  endOn: string,
  existingEnds: string[],
): string | null {
  const priorEnd = existingEnds
    .filter((end) => end < endOn)
    .reduce<string | null>((max, end) => (!max || end > max ? end : max), null);
  return priorEnd ? addDaysIso(priorEnd, 1) : null;
}

/**
 * The latest existing period end that `endOn` would overlap. Periods are
 * consecutive and non-overlapping, so a new end on or before another
 * statement's end carves a period inside it. The own-end is excluded so
 * re-picking an existing period resolves to that statement instead of erroring.
 * `null` when the chosen end is clear.
 */
export function overlappingEnd(
  endOn: string,
  existingEnds: string[],
): string | null {
  const latestOther = existingEnds
    .filter((end) => end !== endOn)
    .reduce<string | null>((max, end) => (!max || end > max ? end : max), null);
  return latestOther && endOn <= latestOther ? latestOther : null;
}

/**
 * Whether `endOn` is a finished entry rather than a value mid-keystroke. Shape
 * only — callers still validate that the date exists on the calendar.
 */
export function isSettledPeriodEnd(endOn: string): boolean {
  if (!ISO_DATE_PATTERN.test(endOn)) return false;
  return Number(endOn.slice(0, 4)) >= MIN_PERIOD_END_YEAR;
}

/**
 * The overlap to surface *while the operator is editing* the period end:
 * `overlappingEnd`, suppressed for an entry that is still being typed. Callers
 * derive this on every render rather than pushing it in with `setError`, so
 * editing the date clears the message by itself. `overlappingEnd` remains the
 * authoritative rule, mirrored server-side on create.
 */
export function liveOverlapEnd(
  endOn: string,
  existingEnds: string[],
): string | null {
  if (!isSettledPeriodEnd(endOn)) return null;
  return overlappingEnd(endOn, existingEnds);
}

/**
 * Whether a removal completed on `completedOn` falls in the reporting window
 * `[derivedStart, endOn]`. A removal with no completion date can never be
 * predicted in-period (Isometric links by completion date).
 */
export function isRemovalInWindow(
  completedOn: string | null,
  derivedStart: string | null,
  endOn: string,
): boolean {
  if (completedOn === null) return false;
  if (completedOn > endOn) return false;
  if (derivedStart !== null && completedOn < derivedStart) return false;
  return true;
}

/**
 * Split removals into those predicted in the reporting window and those
 * outside it, by completion date. Order within each bucket is preserved.
 */
export function partitionByWindow<T extends { completedOn: string | null }>(
  removals: readonly T[],
  derivedStart: string | null,
  endOn: string,
): { inPeriod: T[]; outside: T[] } {
  const inPeriod: T[] = [];
  const outside: T[] = [];
  for (const removal of removals) {
    if (isRemovalInWindow(removal.completedOn, derivedStart, endOn)) {
      inPeriod.push(removal);
    } else {
      outside.push(removal);
    }
  }
  return { inPeriod, outside };
}
