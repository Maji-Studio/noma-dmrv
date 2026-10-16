/**
 * PROTOTYPE (throwaway): a made-up full production for the credit batch overview.
 *
 * Two feedstocks at one facility, one credit batch per feedstock per month
 * (GLOSSARY: credit batch), March to September 2026, with one month that has no
 * batch. Every number is a stub. Each batch links to the real batch page in the
 * scenario that matches its state.
 */

export type BatchState = "blocking" | "ready" | "submitted" | "issued";

export const FEEDSTOCKS = ["Forestry waste", "Maize cobs"] as const;
export type Feedstock = (typeof FEEDSTOCKS)[number];

/** Months shown, as ISO month strings, with their column labels. */
export const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"] as const;
export type Month = (typeof MONTHS)[number];
export const MONTH_LABELS: Record<Month, string> = {
  "2026-03": "Mar",
  "2026-04": "Apr",
  "2026-05": "May",
  "2026-06": "Jun",
  "2026-07": "Jul",
  "2026-08": "Aug",
  "2026-09": "Sep",
};

export interface StubBatch {
  code: string;
  feedstock: Feedstock;
  month: Month;
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

type Row = [Feedstock, Month, BatchState, number, number, number, boolean, string[]];
// feedstock, month, state, produced t, applied share, blocking, sampled, removals
const ROWS: Row[] = [
  ["Forestry waste", "2026-03", "issued", 21.4, 1, 0, true, ["R-01"]],
  ["Maize cobs", "2026-03", "issued", 9.8, 1, 0, true, ["R-01"]],
  ["Forestry waste", "2026-04", "issued", 23.1, 1, 0, false, ["R-02"]],
  ["Maize cobs", "2026-04", "issued", 10.6, 1, 0, false, ["R-02"]],
  ["Forestry waste", "2026-05", "issued", 19.7, 1, 0, false, ["R-03"]],
  ["Maize cobs", "2026-05", "submitted", 8.9, 1, 0, true, ["R-04"]],
  ["Forestry waste", "2026-06", "submitted", 22.8, 0.96, 0, false, ["R-04", "R-05"]],
  // Maize cobs, June: no production, so no batch.
  ["Forestry waste", "2026-07", "submitted", 24.5, 0.9, 0, true, ["R-05"]],
  ["Maize cobs", "2026-07", "ready", 9.4, 0.84, 0, false, []],
  ["Forestry waste", "2026-08", "ready", 21.9, 0.78, 0, false, []],
  ["Maize cobs", "2026-08", "blocking", 11.2, 0.7, 1, false, []],
  ["Forestry waste", "2026-09", "blocking", 22.7, 0.82, 6, true, []],
  ["Maize cobs", "2026-09", "blocking", 9.1, 0.4, 2, false, []],
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

export const BATCHES: StubBatch[] = ROWS.map(([feedstock, month, state, produced, share, blocking, sampled, removals], index) => {
  const applied = round(produced * share);
  const inRemoval = state === "issued" ? applied : state === "submitted" ? round(applied * (removals.length > 1 ? 1 : 0.97)) : 0;
  const submitted = state === "issued" || state === "submitted" ? inRemoval : 0;
  const issued = state === "issued" ? submitted : 0;
  const base = {
    code: `CB-26-${String(index + 1).padStart(3, "0")}`,
    feedstock,
    month,
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

/** Method B: at least one sampled batch in every ten per production process (GLOSSARY: Method A / Method B). */
export const METHOD_B_EVERY = 10;
