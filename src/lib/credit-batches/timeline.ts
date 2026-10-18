/**
 * Pure logic for the credit batch timeline: which window a new credit batch
 * proposes, where a bar sits on a year, and which lifecycle state it shows.
 *
 * A credit batch window is at most one month long but need not follow calendar
 * months (src/lib/credit-batch-production-window.ts), and the windows of one
 * facility and feedstock never overlap, so one timeline row per feedstock always
 * fits. Dates are `YYYY-MM-DD` strings, inclusive on both ends.
 */

const MS_PER_DAY = 86_400_000;
/** Months a search for a free calendar month may look ahead. */
const MAX_MONTH_SEARCH = 120;
const PERCENT = 100;
/** Lifecycle step index (credit-batch-lifecycle.ts) from which a Removal is submitted. */
const SUBMITTED_STEP_INDEX = 1;
/** Lifecycle step index at which credits are issued. */
const ISSUED_STEP_INDEX = 3;

export interface DateWindow {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
}

function toDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The last day of the calendar month a day falls in. */
function endOfMonth(day: number): number {
  const date = new Date(day * MS_PER_DAY);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / MS_PER_DAY - 1;
}

/**
 * The window a new credit batch gets after a batch that ends on `previousEnd`.
 * It starts the day after and runs to the end of that calendar month, or to the
 * day before the next batch (`nextStart`) if that comes first. After the last
 * batch (`nextStart` null) it is the rest of the month, or the whole next month
 * when the last batch ended on a month's last day. Always at most one month.
 * Null when there is no whole day between the two batches.
 */
export function proposeWindow(previousEnd: string, nextStart: string | null): DateWindow | null {
  const start = toDay(previousEnd) + 1;
  const end = nextStart === null ? endOfMonth(start) : Math.min(endOfMonth(start), toDay(nextStart) - 1);
  return end < start ? null : { start: fromDay(start), end: fromDay(end) };
}

/**
 * Every place on a row where a new credit batch fits: each gap filled window by
 * window (month by month), then the rest of the month after the last batch. An
 * empty row has no anchor, so it gets the window of `fallbackMonth` (the month
 * that holds today).
 */
export function newBatchSlots(batches: readonly DateWindow[], fallbackMonth: string): DateWindow[] {
  const rows = [...batches].sort((a, b) => a.start.localeCompare(b.start));
  if (rows.length === 0) return [monthWindow(fallbackMonth)];
  const slots: DateWindow[] = [];
  rows.forEach((batch, index) => {
    const nextStart = rows[index + 1]?.start ?? null;
    let previousEnd = batch.end;
    for (let slot = proposeWindow(previousEnd, nextStart); slot; slot = nextStart ? proposeWindow(previousEnd, nextStart) : null) {
      slots.push(slot);
      previousEnd = slot.end;
    }
  });
  return slots;
}

/** The whole calendar month a day falls in. */
export function monthWindow(date: string): DateWindow {
  const day = toDay(date);
  const first = toDay(`${date.slice(0, 7)}-01`);
  return { start: fromDay(first), end: fromDay(endOfMonth(day)) };
}

/**
 * The window "New credit batch" proposes for one feedstock: the current calendar
 * month, or the next whole calendar month with no batch in it. A partly used
 * month counts as taken.
 */
export function defaultNewBatchWindow(batches: readonly DateWindow[], today: string): DateWindow {
  const [year, month] = today.split("-").map(Number);
  for (let offset = 0; offset < MAX_MONTH_SEARCH; offset += 1) {
    const first = Date.UTC(year, month - 1 + offset, 1) / MS_PER_DAY;
    const window = { start: fromDay(first), end: fromDay(endOfMonth(first)) };
    if (!batches.some((batch) => batch.start <= window.end && batch.end >= window.start)) return window;
  }
  throw new Error("No free calendar month found");
}

export interface BarPlacement {
  /** Percent of the year track. */
  left: number;
  width: number;
  /** The window continues before or after the shown year. */
  cutStart: boolean;
  cutEnd: boolean;
}

function yearSpan(year: number): { first: number; days: number } {
  const first = Date.UTC(year, 0, 1) / MS_PER_DAY;
  return { first, days: Date.UTC(year + 1, 0, 1) / MS_PER_DAY - first };
}

/** Position as percentages of the year track; null when the window is outside the year. */
export function placeOnYear(window: DateWindow, year: number): BarPlacement | null {
  const { first, days } = yearSpan(year);
  const start = toDay(window.start) - first;
  const end = toDay(window.end) - first + 1;
  if (end <= 0 || start >= days) return null;
  const from = Math.max(start, 0);
  const to = Math.min(end, days);
  return {
    left: (from / days) * PERCENT,
    width: ((to - from) / days) * PERCENT,
    cutStart: start < 0,
    cutEnd: end > days,
  };
}

/** Where a day sits on its year track, as a percent of the year. */
export function dayPercentOfYear(date: string): number {
  const year = Number(date.slice(0, 4));
  const { first, days } = yearSpan(year);
  return ((toDay(date) - first) / days) * PERCENT;
}

/** Zero-based month of a date, or -1 when it is not in `year`. */
export function monthIndexIn(year: number, date: string): number {
  return Number(date.slice(0, 4)) === year ? Number(date.slice(5, 7)) - 1 : -1;
}

/**
 * The years a timeline can show, oldest first: every year a window touches, plus
 * the year of `today`. Pass the proposed new-batch slots with the batches, so a
 * trailing slot that falls in the next year can be reached.
 */
export function timelineYears(batches: readonly DateWindow[], today: string): number[] {
  const years = new Set<number>([Number(today.slice(0, 4))]);
  for (const batch of batches) {
    years.add(Number(batch.start.slice(0, 4)));
    years.add(Number(batch.end.slice(0, 4)));
  }
  const sorted = [...years].sort((a, b) => a - b);
  // Fill any hole so the arrows never skip a year.
  const filled: number[] = [];
  for (let year = sorted[0]; year <= sorted[sorted.length - 1]; year += 1) filled.push(year);
  return filled;
}

export type TimelineState = "blocking" | "ready" | "submitted" | "issued";

/**
 * The state a bar shows. A submitted Removal or an issued batch wins over data
 * readiness; otherwise any blocking item means "blocking". Null while the
 * readiness of the batch has not loaded. A failed verification is "blocking"
 * even when no data is missing; a rejected or interrupted Removal (step 0) keeps
 * showing the data readiness.
 */
export function deriveTimelineState(input: {
  lifecycleStepIndex: number;
  lifecycleFailed: boolean;
  healthState: "ready" | "incomplete";
  blockingCount: number;
} | null): TimelineState | null {
  if (!input) return null;
  // A failed verification (a failed step after the Removal was submitted) needs work.
  if (input.lifecycleFailed && input.lifecycleStepIndex >= SUBMITTED_STEP_INDEX) return "blocking";
  if (!input.lifecycleFailed && input.lifecycleStepIndex >= ISSUED_STEP_INDEX) return "issued";
  if (!input.lifecycleFailed && input.lifecycleStepIndex >= SUBMITTED_STEP_INDEX) return "submitted";
  return input.healthState === "ready" && input.blockingCount === 0 ? "ready" : "blocking";
}

export interface TimelineRow<T> {
  feedstockTypeId: string;
  feedstockName: string;
  /** In start order. */
  batches: T[];
}

/** One timeline row per feedstock, by name, each with its batches in start order. */
export function groupByFeedstock<T extends DateWindow & { feedstockTypeId: string; feedstockTypeName: string | null }>(
  batches: readonly T[],
  unnamedFeedstock: string,
): TimelineRow<T>[] {
  const rows = new Map<string, TimelineRow<T>>();
  for (const batch of batches) {
    const row = rows.get(batch.feedstockTypeId) ?? {
      feedstockTypeId: batch.feedstockTypeId,
      feedstockName: batch.feedstockTypeName ?? unnamedFeedstock,
      batches: [],
    };
    row.batches.push(batch);
    rows.set(batch.feedstockTypeId, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, batches: row.batches.sort((a, b) => a.start.localeCompare(b.start)) }))
    .sort((a, b) => a.feedstockName.localeCompare(b.feedstockName));
}
