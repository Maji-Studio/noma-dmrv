/**
 * PROTOTYPE (throwaway): a made-up full production for the credit batch overview.
 *
 * Two feedstocks at one facility, October 2025 to September 2026. A credit batch
 * window is at most one month long but need not follow calendar months (noma rule,
 * src/lib/credit-batch-production-window.ts), and windows of one facility and
 * feedstock never overlap (assertNoOverlappingCreditBatchCohort). So Forestry
 * waste runs calendar months, Maize cobs runs mid-month to mid-month (one batch
 * crosses New Year), Maize cobs pauses in June and July, and one Forestry waste
 * batch is short. Every number is a stub. Each batch links to the real batch
 * page in the scenario that matches its state.
 */

export type BatchState = "blocking" | "ready" | "submitted" | "issued";

export const FEEDSTOCKS = ["Forestry waste", "Maize cobs"] as const;
export type Feedstock = (typeof FEEDSTOCKS)[number];

export interface StubBatch {
  code: string;
  feedstock: Feedstock;
  /** Production window, YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
  state: BatchState;
  /** Tonnes, dry biochar. Each figure is a subset of the one before. */
  produced: number;
  applied: number;
  inRemoval: number;
  submitted: number;
  issued: number;
  blocking: number;
  check: number;
  sampled: boolean;
  /** Removal codes holding this batch's mass. */
  removals: string[];
  /** What the next step is, in a few words. */
  note: string;
}

export const STATE_META: Record<BatchState, { title: string; lane: string; help: string; bar: string; dot: string }> = {
  blocking: { title: "Needs work", lane: "Needs work", help: "Blocking items stop the next Removal.", bar: "bg-[var(--st-bad)]", dot: "bg-[var(--st-bad)]" },
  ready: { title: "Ready", lane: "Ready for a Removal", help: "Nothing blocking. Applied biochar waits for a Removal.", bar: "bg-[var(--st-wait)]", dot: "bg-[var(--st-wait)]" },
  submitted: { title: "Submitted", lane: "Submitted", help: "In a submitted Removal. The GHG Statement is with the verifier.", bar: "bg-[var(--st-run)]", dot: "bg-[var(--st-run)]" },
  issued: { title: "Issued", lane: "Issued", help: "Credits issued. Nothing to do.", bar: "bg-[var(--st-ok)]", dot: "bg-[var(--st-ok)]" },
};

/**
 * The status tag per state, through the shared StatusBadge mapping (status-state.ts):
 * Needs work is an error, Ready waits for a Removal (warning), Submitted is in
 * progress, Issued is success. Timeline colours follow the same ramp.
 */
export const STATE_BADGE: Record<BatchState, { status: "failed" | "pending" | "running" | "issued"; label: string }> = {
  blocking: { status: "failed", label: "Needs work" },
  ready: { status: "pending", label: "Ready" },
  submitted: { status: "running", label: "Submitted" },
  issued: { status: "issued", label: "Issued" },
};

export const STATE_ORDER: BatchState[] = ["blocking", "ready", "submitted", "issued"];

/** The batch page scenario that matches each state (the page shows CB-26-001's real data). */
export const SCENARIO_FOR: Record<BatchState, string> = {
  blocking: "blocking",
  ready: "clear",
  submitted: "partly-sent",
  issued: "issued",
};

type Row = [Feedstock, string, string, BatchState, number, number, number, boolean, string[]];
// feedstock, start, end, state, produced t, applied share, blocking, sampled, removals. In start order.
const ROWS: Row[] = [
  ["Forestry waste", "2025-10-01", "2025-10-31", "issued", 20.1, 1, 0, true, ["R-01"]],
  ["Forestry waste", "2025-11-01", "2025-11-30", "issued", 21.8, 1, 0, false, ["R-01"]],
  ["Maize cobs", "2025-11-15", "2025-12-14", "issued", 8.4, 1, 0, true, ["R-02"]],
  ["Forestry waste", "2025-12-01", "2025-12-31", "issued", 18.2, 1, 0, false, ["R-02"]],
  ["Maize cobs", "2025-12-15", "2026-01-14", "issued", 9.1, 1, 0, false, ["R-03"]],
  ["Forestry waste", "2026-01-01", "2026-01-31", "issued", 19.5, 1, 0, false, ["R-03"]],
  ["Maize cobs", "2026-01-15", "2026-02-14", "issued", 9.6, 1, 0, false, ["R-04"]],
  ["Forestry waste", "2026-02-01", "2026-02-28", "issued", 20.9, 1, 0, false, ["R-04"]],
  ["Forestry waste", "2026-03-01", "2026-03-31", "issued", 21.4, 1, 0, true, ["R-05"]],
  ["Maize cobs", "2026-03-10", "2026-04-09", "issued", 9.8, 1, 0, true, ["R-05"]],
  ["Forestry waste", "2026-04-01", "2026-04-30", "issued", 23.1, 1, 0, false, ["R-06"]],
  ["Maize cobs", "2026-04-10", "2026-05-09", "issued", 10.6, 1, 0, false, ["R-06"]],
  ["Forestry waste", "2026-05-01", "2026-05-31", "submitted", 19.7, 1, 0, false, ["R-07"]],
  ["Maize cobs", "2026-05-10", "2026-06-09", "submitted", 8.9, 1, 0, true, ["R-07"]],
  // Kiln maintenance from Jun 21: a short batch.
  ["Forestry waste", "2026-06-01", "2026-06-20", "submitted", 14.2, 0.96, 0, false, ["R-07", "R-08"]],
  ["Forestry waste", "2026-07-01", "2026-07-31", "submitted", 24.5, 0.9, 0, true, ["R-08"]],
  // Maize cobs pauses Jun 10 to Jul 19 (no harvest), so no batch.
  ["Maize cobs", "2026-07-20", "2026-08-19", "ready", 9.4, 0.84, 0, false, []],
  ["Forestry waste", "2026-08-01", "2026-08-31", "ready", 21.9, 0.78, 0, false, []],
  ["Maize cobs", "2026-08-20", "2026-09-19", "blocking", 11.2, 0.7, 1, false, []],
  ["Forestry waste", "2026-09-01", "2026-09-30", "blocking", 22.7, 0.82, 6, true, []],
  // Still producing: the window ends after today.
  ["Maize cobs", "2026-09-20", "2026-10-19", "blocking", 9.1, 0.4, 2, false, []],
];

const NOTES: Record<BatchState, (b: Omit<StubBatch, "note">) => string> = {
  blocking: (b) => `${b.blocking} blocking ${b.blocking === 1 ? "item" : "items"}`,
  ready: () => "Nothing blocking",
  submitted: (b) => `${b.removals.join(" and ")} submitted, in verification`,
  issued: (b) => `Issued in ${b.removals.join(" and ")}`,
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const yearCounters = new Map<string, number>();

export const BATCHES: StubBatch[] = ROWS.map(([feedstock, start, end, state, produced, share, blocking, sampled, removals]) => {
  const year = start.slice(2, 4);
  const sequence = (yearCounters.get(year) ?? 0) + 1;
  yearCounters.set(year, sequence);
  const applied = round(produced * share);
  const inRemoval = state === "issued" ? applied : state === "submitted" ? round(applied * (removals.length > 1 ? 1 : 0.97)) : 0;
  const submitted = state === "issued" || state === "submitted" ? inRemoval : 0;
  const issued = state === "issued" ? submitted : 0;
  const base = {
    code: `CB-${year}-${String(sequence).padStart(3, "0")}`,
    feedstock,
    start,
    end,
    state,
    produced,
    applied,
    inRemoval,
    submitted,
    issued,
    blocking,
    check: state === "blocking" || state === "ready" ? 1 : 0,
    sampled,
    removals,
  };
  return { ...base, note: NOTES[state](base) };
});

/** Years the timeline can show, oldest first. */
export const YEARS = [...new Set(BATCHES.flatMap((batch) => [Number(batch.start.slice(0, 4)), Number(batch.end.slice(0, 4))]))].sort();

export interface PipelineStage {
  key: "produced" | "applied" | "inRemoval" | "submitted" | "issued";
  label: string;
  tons: number;
  /** The mass that stopped at this stage, and what that gap means. */
  gap: { tons: number; label: string } | null;
}

function sum(key: keyof Pick<StubBatch, "produced" | "applied" | "inRemoval" | "submitted" | "issued">): number {
  return round(BATCHES.reduce((total, batch) => total + batch[key], 0));
}

export function pipeline(): PipelineStage[] {
  const produced = sum("produced");
  const applied = sum("applied");
  const inRemoval = sum("inRemoval");
  const submitted = sum("submitted");
  const issued = sum("issued");
  return [
    { key: "produced", label: "Produced", tons: produced, gap: null },
    { key: "applied", label: "Applied", tons: applied, gap: { tons: round(produced - applied), label: "not applied yet" } },
    { key: "inRemoval", label: "In a Removal", tons: inRemoval, gap: { tons: round(applied - inRemoval), label: "not in a Removal" } },
    { key: "submitted", label: "Submitted", tons: submitted, gap: { tons: round(inRemoval - submitted), label: "in draft Removals" } },
    { key: "issued", label: "Issued", tons: issued, gap: { tons: round(submitted - issued), label: "in verification" } },
  ];
}

/** Batches that hold mass in a stage's gap: the ones the operator acts on for that stage. */
export function matchesStage(batch: StubBatch, stage: PipelineStage["key"] | null): boolean {
  switch (stage) {
    case null:
    case "produced":
      return true;
    case "applied":
      return batch.produced - batch.applied > 0.005;
    case "inRemoval":
      return batch.applied - batch.inRemoval > 0.005;
    case "submitted":
      return batch.inRemoval - batch.submitted > 0.005;
    case "issued":
      return batch.submitted - batch.issued > 0.005;
  }
}


/* ---------- Proposed windows for a new credit batch ---------- */

const DAY_MS = 86_400_000;
/** Months a search for a free calendar month may look ahead. */
const MAX_MONTH_SEARCH = 120;

export interface ProposedWindow {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
}

function toDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** The last day of the calendar month a day falls in. */
function endOfMonth(day: number): number {
  const date = new Date(day * DAY_MS);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / DAY_MS - 1;
}

/**
 * The window a new credit batch gets after a batch that ends on `previousEnd`.
 * It starts the day after and runs to the end of that calendar month, or to the
 * day before the next batch (`nextStart`) if that comes first. After the last
 * batch (`nextStart` null) it is the rest of the month, or the whole next month
 * when the last batch ended on a month's last day. Always at most one month.
 * Null when there is no whole day between the two batches.
 */
export function proposeWindow(previousEnd: string, nextStart: string | null): ProposedWindow | null {
  const start = toDay(previousEnd) + 1;
  const end = nextStart === null ? endOfMonth(start) : Math.min(endOfMonth(start), toDay(nextStart) - 1);
  return end < start ? null : { start: fromDay(start), end: fromDay(end) };
}

export interface NewBatchSlot extends ProposedWindow {
  feedstock: Feedstock;
}

/** Every place on a row where a new credit batch fits: each gap filled window by window, then one window after the last batch. */
export function slotsFor(feedstock: Feedstock, batches: { start: string; end: string }[]): NewBatchSlot[] {
  const rows = [...batches].sort((a, b) => a.start.localeCompare(b.start));
  const slots: NewBatchSlot[] = [];
  rows.forEach((batch, index) => {
    const nextStart = rows[index + 1]?.start ?? null;
    let previousEnd = batch.end;
    for (let window = proposeWindow(previousEnd, nextStart); window; window = nextStart ? proposeWindow(previousEnd, nextStart) : null) {
      slots.push({ ...window, feedstock });
      previousEnd = window.end;
    }
  });
  return slots;
}

export function newBatchSlots(feedstock: Feedstock): NewBatchSlot[] {
  return slotsFor(feedstock, BATCHES.filter((batch) => batch.feedstock === feedstock));
}

/**
 * The window the header "New credit batch" button proposes for one facility and
 * feedstock: the current calendar month, or the next whole calendar month with
 * no batch in it. A partly used month counts as taken.
 */
export function defaultNewBatchWindow(batches: { start: string; end: string }[], today: string): ProposedWindow {
  const [year, month] = today.split("-").map(Number);
  for (let offset = 0; offset < MAX_MONTH_SEARCH; offset += 1) {
    const first = Date.UTC(year, month - 1 + offset, 1) / DAY_MS;
    const window = { start: fromDay(first), end: fromDay(endOfMonth(first)) };
    if (!batches.some((batch) => batch.start <= window.end && batch.end >= window.start)) return window;
  }
  throw new Error("No free calendar month found");
}
