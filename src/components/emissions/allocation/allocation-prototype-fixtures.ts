/**
 * PROTOTYPE ONLY (allocation chart round, `?scenario=`). Client-side stand-ins
 * for the facility-wide allocation so the variants can be judged with many
 * records, few, or none. Built from the shapes in `allocation-test-fixtures.ts`;
 * every figure is computed here from wet mass and distance, nothing is read
 * from the server. Delete with the losing variants once a pick is folded in.
 */
import { NOT_YET, type AllocationRecord, type EmissionAllocation, type FeedstockUse, type Part } from "@/types/emission-allocation";

export const SCENARIOS = ["many", "few", "empty"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const PROTO_REMOVAL_ID = "proto-removal-1";
const OTHER_REMOVAL_ID = "proto-removal-2";
const OTHER_BATCH_ID = "proto-batch-2";
const FALLBACK_PAGE_CODE = "CB-26-001";
const OTHER_CODES = ["CB-26-002", "CB-26-003"];

const PAGE_PERIOD = { startDate: "2026-09-01", endDate: "2026-09-30" };
const OTHER_PERIOD = { startDate: "2026-10-01", endDate: "2026-10-31" };

/** Many: 30 deliveries the page uses whole, 2 it carries but used only partly, 5 on the other batch, 3 untouched. */
const FS_PAGE_WHOLE = 30;
const FS_PAGE_PARTLY = 2;
const FS_OTHER = 5;
const FS_NOT_YET = 3;
const KG_PER_TONNE = 1000;
const ROUND_TRIP = 2;
const BASE_WET_KG = 8000;
const WET_KG_STEP = 1373;
const WET_KG_SPAN = 6000;
const BASE_KM = 18;
const KM_STEP = 17;
const KM_SPAN = 47;
const PARTLY_USED_SHARE = 0.6;
const PARTLY_LOST_SHARE = 0.05;
const ONE_DECIMAL = 10;

interface Ctx {
  pageId: string;
  pageCode: string;
  otherCode: string;
}

const round1 = (value: number) => Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
const pad = (value: number) => String(value).padStart(3, "0");

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Batch parts and the Removal parts that follow them: each batch is claimed by its own Removal. */
function removalPartsFor(parts: Part[], ctx: Ctx): Part[] {
  return parts
    .filter((part) => part.fraction > 0)
    .map((part) => {
      if (part.key === NOT_YET) return { key: NOT_YET, fraction: part.fraction, basis: [{ kind: "notYet", label: "", kg: null }] };
      const removal = part.key === ctx.pageId ? PROTO_REMOVAL_ID : OTHER_REMOVAL_ID;
      return { key: removal, fraction: part.fraction, basis: [{ kind: "claim", label: part.key === ctx.pageId ? ctx.pageCode : ctx.otherCode, kg: null }] };
    });
}

type FsKind = "pageWhole" | "pagePartly" | "other" | "notYet";

function feedstock(index: number, day: string, kind: FsKind, ctx: Ctx, firstRun: { code: string; date: string } | null): AllocationRecord {
  const id = `proto-fs-${index}`;
  const code = `FS-26-${pad(index)}`;
  const wetKg = BASE_WET_KG + ((index * WET_KG_STEP) % WET_KG_SPAN);
  const oneWayKm = BASE_KM + ((index * KM_STEP) % KM_SPAN);
  const tonneKm = round1((wetKg / KG_PER_TONNE) * oneWayKm * ROUND_TRIP);
  const bin = index % 2 ? "North bay" : "South bay";
  const ownerId = kind === "pageWhole" || kind === "pagePartly" ? ctx.pageId : kind === "other" ? OTHER_BATCH_ID : null;
  const ownerCode = ownerId === ctx.pageId ? ctx.pageCode : ctx.otherCode;
  const usedKg = kind === "pagePartly" ? Math.round(wetKg * PARTLY_USED_SHARE) : wetKg;
  const lostKg = kind === "pagePartly" ? Math.round(wetKg * PARTLY_LOST_SHARE) : 0;
  const used: FeedstockUse["used"] =
    ownerId === null
      ? []
      : kind === "pagePartly"
        ? [
            { creditBatchId: ctx.pageId, code: ctx.pageCode, kg: usedKg, runs: [firstRun?.code ?? ""] },
            { creditBatchId: OTHER_BATCH_ID, code: ctx.otherCode, kg: wetKg - usedKg - lostKg, runs: ["PR-26-006"] },
          ]
        : [{ creditBatchId: ownerId, code: ownerCode, kg: wetKg, runs: [firstRun?.code ?? ""] }];
  const parts: Part[] =
    ownerId === null
      ? [{ key: NOT_YET, fraction: 1, basis: [{ kind: "notYet", label: bin, kg: wetKg }] }]
      : [
          { key: ownerId, fraction: 1, basis: [{ kind: "firstRun", label: firstRun?.code ?? "", kg: null }] },
          ...(kind === "pagePartly" ? [{ key: OTHER_BATCH_ID, fraction: 0, basis: [{ kind: "run" as const, label: ctx.otherCode, kg: wetKg - usedKg - lostKg }] }] : []),
        ];
  return {
    id,
    code,
    group: "feedstockTransport",
    date: day,
    detail: { kind: "feedstockTransport", binId: bin, binName: bin, wetKg, legs: [{ id: `${id}-leg`, oneWayKm, loadKg: wetKg }] },
    quantities: [{ value: tonneKm, unit: "t·km", label: "Transport" }],
    parts,
    removalParts: removalPartsFor(parts, ctx),
    basisWord: "the first run that drew from it",
    feedstock: {
      bin,
      binId: bin,
      wetKg,
      tonneKm,
      used,
      out: lostKg ? [{ kind: "lost", date: null, kg: lostKg }] : [],
      lostKg,
      stillKg: ownerId === null ? wetKg : 0,
      ingredientKg: 0,
      countKg: 0,
      unbatchedRunKg: 0,
      firstRun: firstRun && ownerId ? { id: `${id}-run`, code: firstRun.code, date: firstRun.date, creditBatchId: ownerId } : undefined,
      owner: ownerId,
      reason: ownerId ? "firstRun" : "notYet",
    },
  };
}

function run(index: number, day: string, batchId: string, startupL: number | null, gensetL: number | null, kwh: number, ctx: Ctx): AllocationRecord {
  const code = `PR-26-${pad(index)}`;
  const parts: Part[] = [{ key: batchId, fraction: 1, basis: [{ kind: "run", label: code, kg: null }] }];
  return {
    id: `proto-run-${index}`,
    code,
    group: "production",
    date: day,
    detail: { kind: "production", reactorId: "proto-reactor", reactorCode: "RX-1" },
    quantities: [
      { value: startupL, unit: "L", label: "Startup diesel" },
      { value: gensetL, unit: "L", label: "Generator diesel" },
      { value: kwh, unit: "kWh", label: "Electricity" },
    ],
    parts,
    removalParts: removalPartsFor(parts, ctx),
    basisWord: "the run",
  };
}

function delivery(index: number, day: string, wetKg: number, oneWayKm: number, split: { key: string; fraction: number }[], ctx: Ctx): AllocationRecord {
  const tonneKm = round1((wetKg / KG_PER_TONNE) * oneWayKm * ROUND_TRIP);
  const parts: Part[] = split.map(({ key, fraction }) => ({
    key,
    fraction,
    basis: [{ kind: key === NOT_YET ? "notYet" : "load", label: key === ctx.pageId ? ctx.pageCode : key === NOT_YET ? "" : ctx.otherCode, kg: Math.round(wetKg * fraction) }],
  }));
  return {
    id: `proto-dl-${index}`,
    code: `DL-26-${pad(index)}`,
    group: "deliveryTransport",
    date: day,
    detail: { kind: "deliveryTransport", wetKg, oneWayKm },
    quantities: [{ value: tonneKm, unit: "t·km", label: "Transport" }],
    parts,
    removalParts: removalPartsFor(parts, ctx),
    basisWord: "biochar on the load",
  };
}

function manualTransport(ctx: Ctx): AllocationRecord {
  const parts: Part[] = [{ key: ctx.pageId, fraction: 1, basis: [{ kind: "recordedOnBatch", label: "proto-chipper", kg: null }] }];
  return {
    id: "proto-manual-1",
    code: "proto-chipper",
    group: "manual",
    date: "2026-09-15",
    detail: { kind: "manual", creditBatchId: ctx.pageId, componentId: "proto-chipper", componentName: "Chipper transport", kindOfEntry: "value", omittedInputKeys: [] },
    quantities: [{ value: 85, unit: "t·km", label: "Transport" }],
    parts,
    removalParts: removalPartsFor(parts, ctx),
    basisWord: "the batch it was recorded on",
  };
}

/* Run days: five in the page batch's month, three in the next. */
const PAGE_RUN_DAYS = ["2026-09-03", "2026-09-08", "2026-09-13", "2026-09-19", "2026-09-25"];
const OTHER_RUN_DAYS = ["2026-10-04", "2026-10-12", "2026-10-20"];
const FIRST_FS_DAY = "2026-08-18";
const PAGE_FS_EVERY_DAYS = 1.3;
const PARTLY_FS_DAYS = ["2026-09-21", "2026-09-23"];
const OTHER_FS_FIRST_DAY = "2026-10-01";
const OTHER_FS_EVERY_DAYS = 2;
const NOT_YET_FS_FIRST_DAY = "2026-10-12";
const NOT_YET_FS_EVERY_DAYS = 2;
const DIESEL_STARTUP_L = [22, 18, 26, 19, 24, 21, 30, null];
const DIESEL_GENSET_L = [64, 48, 72, 55, 90, 41, null, null];
const ELECTRICITY_KWH = [168, 212, 305, 190, 420, 256, 233, 150];

function many(ctx: Ctx): AllocationRecord[] {
  const runCode = (day: string) => `PR-26-${pad([...PAGE_RUN_DAYS, ...OTHER_RUN_DAYS].indexOf(day) + 1)}`;
  const firstRunAfter = (day: string, days: string[]) => {
    const next = days.find((candidate) => candidate >= day) ?? days[days.length - 1];
    return { code: runCode(next), date: next };
  };
  const records: AllocationRecord[] = [];
  let index = 1;
  for (let i = 0; i < FS_PAGE_WHOLE; i += 1) {
    const day = addDays(FIRST_FS_DAY, Math.floor(i * PAGE_FS_EVERY_DAYS));
    records.push(feedstock(index++, day, "pageWhole", ctx, firstRunAfter(day, PAGE_RUN_DAYS)));
  }
  for (let i = 0; i < FS_PAGE_PARTLY; i += 1) {
    const day = PARTLY_FS_DAYS[i];
    records.push(feedstock(index++, day, "pagePartly", ctx, firstRunAfter(day, PAGE_RUN_DAYS)));
  }
  for (let i = 0; i < FS_OTHER; i += 1) {
    const day = addDays(OTHER_FS_FIRST_DAY, i * OTHER_FS_EVERY_DAYS);
    records.push(feedstock(index++, day, "other", ctx, firstRunAfter(day, OTHER_RUN_DAYS)));
  }
  for (let i = 0; i < FS_NOT_YET; i += 1) {
    records.push(feedstock(index++, addDays(NOT_YET_FS_FIRST_DAY, i * NOT_YET_FS_EVERY_DAYS), "notYet", ctx, null));
  }
  [...PAGE_RUN_DAYS, ...OTHER_RUN_DAYS].forEach((day, i) => {
    const batch = i < PAGE_RUN_DAYS.length ? ctx.pageId : OTHER_BATCH_ID;
    records.push(run(i + 1, day, batch, DIESEL_STARTUP_L[i], DIESEL_GENSET_L[i], ELECTRICITY_KWH[i], ctx));
  });
  records.push(delivery(1, "2026-09-29", 5000, 36, [{ key: ctx.pageId, fraction: 1 }], ctx));
  records.push(delivery(2, "2026-10-15", 6500, 40, [{ key: ctx.pageId, fraction: 0.6 }, { key: OTHER_BATCH_ID, fraction: 0.4 }], ctx));
  records.push(delivery(3, "2026-10-28", 4200, 49, [{ key: OTHER_BATCH_ID, fraction: 0.7 }, { key: NOT_YET, fraction: 0.3 }], ctx));
  records.push(manualTransport(ctx));
  return records;
}

function few(ctx: Ctx): AllocationRecord[] {
  const firstRun = { code: "PR-26-001", date: "2026-09-08" };
  return [
    feedstock(1, "2026-09-04", "pageWhole", ctx, firstRun),
    run(1, firstRun.date, ctx.pageId, 22, 64, 168, ctx),
    delivery(1, "2026-09-24", 5000, 36, [{ key: ctx.pageId, fraction: 1 }], ctx),
  ];
}

/** The allocation a scenario stands in for, around the page's own credit batch. */
export function scenarioAllocation(scenario: Scenario, pageId: string, pageCode: string | undefined): EmissionAllocation {
  const code = pageCode ?? FALLBACK_PAGE_CODE;
  const ctx: Ctx = { pageId, pageCode: code, otherCode: OTHER_CODES.find((candidate) => candidate !== code) ?? OTHER_CODES[0] };
  const withOther = scenario === "many";
  return {
    facilityId: "proto-facility",
    batches: [
      { id: pageId, code, ...PAGE_PERIOD },
      ...(withOther ? [{ id: OTHER_BATCH_ID, code: ctx.otherCode, ...OTHER_PERIOD }] : []),
    ],
    removals: [
      { id: PROTO_REMOVAL_ID, code: "RM-26-001", status: "draft", creditBatchIds: [pageId], canSendProduction: true },
      ...(withOther ? [{ id: OTHER_REMOVAL_ID, code: "RM-26-002", status: "submitted", creditBatchIds: [OTHER_BATCH_ID] }] : []),
    ],
    records: scenario === "many" ? many(ctx) : scenario === "few" ? few(ctx) : [],
  };
}
