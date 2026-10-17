/**
 * PROTOTYPE fixture: one facility, one month (Oct 2026), shaped like the real
 * records. In memory only. Throwaway, never merges (issues #1109 and #1110).
 */

export const FACILITY_NAME = "Mafinga plant";
export const MONTH_LABEL = "October 2026";
export const MONTH_START = "2026-10-01";
export const MONTH_END = "2026-10-31";

export type FeedstockName = "Maize stover" | "Rice husk" | "Sawdust";

export interface RunRecord {
  code: string;
  reactor: string;
  startedAt: string; // facility local, "YYYY-MM-DD HH:mm"
  endedAt: string;
  feedstock: FeedstockName;
  feedstockKg: number;
  biocharKg: number;
  batchCode: string | null;
  dieselL: number | null;
  gridKwh: number | null;
}

export interface BatchRecord {
  code: string;
  feedstock: FeedstockName;
  periodStart: string;
  periodEnd: string;
  state: "draft" | "pending" | "verified";
  stateNote: string;
}

export const RUNS: RunRecord[] = [
  { code: "PR-26-0136", reactor: "Reactor 1", startedAt: "2026-09-17 07:10", endedAt: "2026-09-17 16:20", feedstock: "Maize stover", feedstockKg: 2300, biocharKg: 575, batchCode: "CB-26-012", dieselL: 36, gridKwh: 390 },
  { code: "PR-26-0138", reactor: "Reactor 1", startedAt: "2026-09-24 07:05", endedAt: "2026-09-24 16:45", feedstock: "Maize stover", feedstockKg: 2400, biocharKg: 606, batchCode: "CB-26-012", dieselL: 38, gridKwh: 402 },
  { code: "PR-26-0141", reactor: "Reactor 1", startedAt: "2026-09-30 20:30", endedAt: "2026-10-01 06:15", feedstock: "Maize stover", feedstockKg: 2400, biocharKg: 612, batchCode: "CB-26-012", dieselL: 38, gridKwh: 410 },
  { code: "PR-26-0142", reactor: "Reactor 2", startedAt: "2026-10-02 07:00", endedAt: "2026-10-02 15:40", feedstock: "Rice husk", feedstockKg: 1800, biocharKg: 441, batchCode: "CB-26-013", dieselL: 29, gridKwh: 305 },
  { code: "PR-26-0143", reactor: "Reactor 1", startedAt: "2026-10-04 07:20", endedAt: "2026-10-04 17:05", feedstock: "Maize stover", feedstockKg: 2650, biocharKg: 668, batchCode: "CB-26-012", dieselL: 41, gridKwh: null },
  { code: "PR-26-0144", reactor: "Reactor 2", startedAt: "2026-10-07 06:50", endedAt: "2026-10-07 15:10", feedstock: "Sawdust", feedstockKg: 2100, biocharKg: 556, batchCode: "CB-26-014", dieselL: 33, gridKwh: 352 },
  { code: "PR-26-0145", reactor: "Reactor 1", startedAt: "2026-10-11 07:00", endedAt: "2026-10-11 16:30", feedstock: "Maize stover", feedstockKg: 2500, biocharKg: 640, batchCode: "CB-26-012", dieselL: null, gridKwh: 398 },
  { code: "PR-26-0146", reactor: "Reactor 2", startedAt: "2026-10-15 07:10", endedAt: "2026-10-15 15:50", feedstock: "Rice husk", feedstockKg: 1950, biocharKg: 468, batchCode: "CB-26-013", dieselL: 31, gridKwh: 322 },
  { code: "PR-26-0147", reactor: "Reactor 1", startedAt: "2026-10-19 07:00", endedAt: "2026-10-19 16:15", feedstock: "Sawdust", feedstockKg: 2300, biocharKg: 598, batchCode: "CB-26-014", dieselL: 36, gridKwh: 380 },
  { code: "PR-26-0148", reactor: "Reactor 2", startedAt: "2026-10-23 07:05", endedAt: "2026-10-23 16:00", feedstock: "Rice husk", feedstockKg: 2000, biocharKg: 492, batchCode: "CB-26-013", dieselL: 30, gridKwh: null },
  { code: "PR-26-0149", reactor: "Reactor 1", startedAt: "2026-10-28 07:00", endedAt: "2026-10-28 16:40", feedstock: "Maize stover", feedstockKg: 2450, biocharKg: 612, batchCode: null, dieselL: 37, gridKwh: 401 },
  { code: "PR-26-0150", reactor: "Reactor 2", startedAt: "2026-10-30 07:15", endedAt: "2026-10-30 15:55", feedstock: "Rice husk", feedstockKg: 1900, biocharKg: 456, batchCode: null, dieselL: null, gridKwh: null },
];

/** A run still running at month end: not counted anywhere yet. */
export const RUNNING_RUN = { code: "PR-26-0151", startedAt: "2026-10-31 07:10" };

export const BATCHES: BatchRecord[] = [
  { code: "CB-26-012", feedstock: "Maize stover", periodStart: "2026-09-15", periodEnd: "2026-10-12", state: "pending", stateNote: "Submitted to the registry, awaiting review" },
  { code: "CB-26-013", feedstock: "Rice husk", periodStart: "2026-10-01", periodEnd: "2026-10-24", state: "draft", stateNote: "Not submitted yet" },
  { code: "CB-26-014", feedstock: "Sawdust", periodStart: "2026-10-06", periodEnd: "2026-10-29", state: "verified", stateNote: "Verified, ready to issue" },
];

export const FEEDSTOCK_IN: { type: FeedstockName; deliveries: number; kg: number }[] = [
  { type: "Maize stover", deliveries: 4, kg: 14200 },
  { type: "Rice husk", deliveries: 3, kg: 9800 },
  { type: "Sawdust", deliveries: 2, kg: 5400 },
];

export const DELIVERIES = [
  { code: "DL-26-0058", date: "2026-10-06", customer: "Kilombero Farmers Co-op", kg: 1200, status: "delivered" as const },
  { code: "DL-26-0059", date: "2026-10-13", customer: "Iringa Orchard Group", kg: 900, status: "delivered" as const },
  { code: "DL-26-0060", date: "2026-10-21", customer: "Kilombero Farmers Co-op", kg: 1400, status: "delivered" as const },
  { code: "DL-26-0061", date: "2026-10-29", customer: "Mufindi Tea Estate", kg: 600, status: "delivered" as const },
];

export const APPLICATIONS = [
  { code: "AP-26-0031", date: "2026-10-08", field: "Kilombero block 4", kg: 700, status: "applied" as const },
  { code: "AP-26-0032", date: "2026-10-15", field: "Iringa orchard east", kg: 520, status: "applied" as const },
  { code: "AP-26-0033", date: "2026-10-24", field: "Kilombero block 7", kg: 630, status: "applied" as const },
];

/* ---------------- derived figures (plain reads, no AI) ---------------- */

export const endDay = (r: RunRecord) => r.endedAt.slice(0, 10);
export const startDay = (r: RunRecord) => r.startedAt.slice(0, 10);
export const endedInMonth = (r: RunRecord) => endDay(r) >= MONTH_START && endDay(r) <= MONTH_END;
export const straddles = (r: RunRecord) => startDay(r) < MONTH_START && endedInMonth(r);

export const monthRuns = RUNS.filter(endedInMonth);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const totals = {
  runCount: monthRuns.length,
  feedstockKg: sum(monthRuns.map((r) => r.feedstockKg)),
  biocharKg: sum(monthRuns.map((r) => r.biocharKg)),
  yield: (() => {
    const f = sum(monthRuns.map((r) => r.feedstockKg));
    return f > 0 ? sum(monthRuns.map((r) => r.biocharKg)) / f : null;
  })(),
  feedstockInKg: sum(FEEDSTOCK_IN.map((f) => f.kg)),
  deliveredKg: sum(DELIVERIES.map((d) => d.kg)),
  appliedKg: sum(APPLICATIONS.map((a) => a.kg)),
};

export function runYield(r: { feedstockKg: number; biocharKg: number }): number | null {
  return r.feedstockKg > 0 ? r.biocharKg / r.feedstockKg : null;
}

export interface EnergyFigure {
  runCount: number;
  dieselL: number;
  gridKwh: number;
  missingDiesel: number;
  missingGrid: number;
}

export function energyFor(runs: RunRecord[]): EnergyFigure {
  return {
    runCount: runs.length,
    dieselL: sum(runs.map((r) => r.dieselL ?? 0)),
    gridKwh: sum(runs.map((r) => r.gridKwh ?? 0)),
    missingDiesel: runs.filter((r) => r.dieselL === null).length,
    missingGrid: runs.filter((r) => r.gridKwh === null).length,
  };
}

/** Energy is summed over ALL runs inside the batch period, whatever month they ended in. */
export const batchRows = BATCHES.map((b) => {
  const runs = RUNS.filter((r) => r.batchCode === b.code);
  return { batch: b, runs, energy: energyFor(runs), monthRunCount: runs.filter(endedInMonth).length };
});

export const unbatchedRuns = monthRuns.filter((r) => r.batchCode === null);
export const unbatched = { runs: unbatchedRuns, energy: energyFor(unbatchedRuns) };
