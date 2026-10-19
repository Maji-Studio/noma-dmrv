/**
 * PROTOTYPE: the month-state model for variant A. Builds the figures for
 * `empty`, `partial` and `full` from the shared fixture. Throwaway.
 */
import {
  APPLICATIONS, BATCHES, DELIVERIES, FACILITY_NAME, FEEDSTOCK_IN, RUNNING_RUN, RUNS, energyFor, endDay,
  type RunRecord,
} from "./fixture";

export type MonthState = "empty" | "partial" | "full";
export const STATES: { key: MonthState; name: string }[] = [
  { key: "empty", name: "Empty" },
  { key: "partial", name: "In progress" },
  { key: "full", name: "Closed" },
];

/** The partial month is October as it stood on this day, midday. */
export const PARTIAL_AS_OF = "2026-10-19 12:00";
export const PARTIAL_AS_OF_DAY = "2026-10-19";
const PARTIAL_FEEDSTOCK_IN = [
  { type: "Maize stover" as const, deliveries: 3, kg: 10100 },
  { type: "Rice husk" as const, deliveries: 2, kg: 6200 },
  { type: "Sawdust" as const, deliveries: 1, kg: 2600 },
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function parseState(s: string | undefined): MonthState {
  return s === "empty" || s === "partial" ? s : "full";
}

export function monthLabelFor(state: MonthState) {
  return state === "empty" ? "November 2026" : "October 2026";
}

export function buildReport(state: Exclude<MonthState, "empty">) {
  const asOf = state === "partial" ? PARTIAL_AS_OF : "2026-10-31 23:59";
  const asOfDay = asOf.slice(0, 10);
  const inMonth = (r: RunRecord) => endDay(r) >= "2026-10-01" && r.endedAt <= asOf;
  const runs = RUNS.filter(inMonth);
  const running: { code: string; startedDay: string }[] = [
    ...RUNS.filter((r) => r.startedAt <= asOf && r.endedAt > asOf).map((r) => ({ code: r.code, startedDay: r.startedAt.slice(0, 10) })),
    ...(state === "full" ? [{ code: RUNNING_RUN.code, startedDay: RUNNING_RUN.startedAt.slice(0, 10) }] : []),
  ];
  const feedstockIn = state === "partial" ? PARTIAL_FEEDSTOCK_IN : FEEDSTOCK_IN;
  const deliveries = DELIVERIES.filter((d) => d.date <= asOfDay);
  const applications = APPLICATIONS.filter((a) => a.date <= asOfDay);
  const batches = BATCHES.filter((b) => b.periodEnd <= asOfDay).map((b) => {
    const batchRuns = RUNS.filter((r) => r.batchCode === b.code && r.endedAt <= asOf);
    return { batch: b, runs: batchRuns, energy: energyFor(batchRuns), monthRunCount: batchRuns.filter(inMonth).length };
  });
  const unbatchedRuns = runs.filter((r) => r.batchCode === null);
  const feedstockKg = sum(runs.map((r) => r.feedstockKg));
  const biocharKg = sum(runs.map((r) => r.biocharKg));
  return {
    facility: FACILITY_NAME,
    asOfDay,
    runs,
    running,
    feedstockIn,
    deliveries,
    applications,
    batches,
    unbatched: { runs: unbatchedRuns, energy: energyFor(unbatchedRuns) },
    totals: {
      feedstockKg,
      biocharKg,
      yield: feedstockKg > 0 ? biocharKg / feedstockKg : null,
      feedstockInKg: sum(feedstockIn.map((f) => f.kg)),
      feedstockInCount: sum(feedstockIn.map((f) => f.deliveries)),
      deliveredKg: sum(deliveries.map((d) => d.kg)),
      appliedKg: sum(applications.map((a) => a.kg)),
    },
  };
}
