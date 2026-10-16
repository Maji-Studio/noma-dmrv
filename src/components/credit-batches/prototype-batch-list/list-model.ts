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
  ready: { title: "Ready", lane: "Ready for a Removal", help: "Nothing blocking. Applied biochar waits for a Removal.", bar: "bg-[var(--ink)]", dot: "bg-[var(--ink)]" },
  submitted: { title: "Submitted", lane: "Submitted", help: "In a submitted Removal. The GHG Statement is with the verifier.", bar: "bg-[var(--st-run)]", dot: "bg-[var(--st-run)]" },
  issued: { title: "Issued", lane: "Issued", help: "Credits issued. Nothing to do.", bar: "bg-[var(--st-ok)]", dot: "bg-[var(--st-ok)]" },
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

