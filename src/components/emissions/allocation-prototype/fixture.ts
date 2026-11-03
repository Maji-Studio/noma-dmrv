/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Fixture that
 * mirrors staging facility TZ001: Pine Off-cuts, three credit batches, three
 * Removals. Every share is computed here from draws and loads, so each record
 * adds up to 100%. Round 3 keeps today's rule (Kenji, 2026-11-03): a feedstock
 * delivery's whole transport goes to the credit batch of the earliest
 * completed run that draws from it; mass that leaves a bin without any run
 * puts it on the batch whose production period holds that date; otherwise it
 * is not yet allocated. No CO2e anywhere: Isometric computes it (ADR 0031).
 */
import { countedRoundTripKm } from "@/lib/calculations/round-trip";

export type BatchCode = "CB-26-001" | "CB-26-002" | "CB-26-003";
export const NOT_YET = "notYet" as const;
export type PartKey = BatchCode | typeof NOT_YET;
export type Unit = "t·km" | "L" | "kWh";
export type GroupKey = "feedstockTransport" | "production" | "deliveryTransport" | "manual";

export interface Batch {
  code: BatchCode;
  month: string;
  startDate: string;
  endDate: string;
}

export const BATCHES: Batch[] = [
  { code: "CB-26-001", month: "Feb 2026", startDate: "2026-02-01", endDate: "2026-02-28" },
  { code: "CB-26-002", month: "Mar 2026", startDate: "2026-03-01", endDate: "2026-03-31" },
  { code: "CB-26-003", month: "Apr 2026", startDate: "2026-04-01", endDate: "2026-04-30" },
];

export const FEEDSTOCK_TYPE = "Pine Off-cuts";
export const FACILITY = "TZ001";

export interface Quantity {
  value: number;
  unit: Unit;
  /** What the figure is: "Transport", "Diesel", "Electricity". */
  label: string;
}

/** What a part is made of, for the explanation: a draw, a product slice, a whole record. */
export interface PartBasis {
  /** "PR-26-001", "CB-26-001 product", "Still in North bay". */
  label: string;
  kg: number | null;
}

export interface Part {
  key: PartKey;
  fraction: number;
  basis: PartBasis[];
}

export interface SourceRecord {
  id: string;
  code: string;
  group: GroupKey;
  date: string;
  /** One short line: "North bay, 10,000 kg wet, 42 km". */
  detail: string;
  quantities: Quantity[];
  parts: Part[];
  /** What the shares are measured in: "wet mass drawn", "biochar on the load". */
  basisWord: string;
  /** Feedstock deliveries only: where the wet mass went and why one batch carries the leg. */
  feedstock?: FeedstockUse;
}

/** Wet mass one credit batch's runs drew from a delivery. */
export interface BatchUse {
  batch: BatchCode;
  kg: number;
  runs: string[];
}

/** Mass that left a bin without a completed run. */
export interface MassOut {
  kind: "lost" | "withdrawn" | "failedRun";
  date: string;
  kg: number;
}

export interface FeedstockUse {
  bin: string;
  wetKg: number;
  /** Transport of the whole delivery, round trip. */
  tonneKm: number;
  used: BatchUse[];
  out: MassOut[];
  stillKg: number;
  /** The earliest completed run that drew from it. */
  firstRun?: { code: string; date: string; batch: BatchCode };
  /** The batch that carries the whole leg, or null while not yet allocated. */
  owner: BatchCode | null;
  reason: "firstRun" | "leftInPeriod" | "notYet";
}

export const GROUPS: { key: GroupKey; title: string; rule: string }[] = [
  {
    key: "feedstockTransport",
    title: "Feedstock transport",
    rule: "A feedstock delivery's whole transport goes to the credit batch whose production run drew from it first. Other batches that draw from it show Counted on. If mass leaves the bin without a run, the batch whose production period holds that date carries it.",
  },
  {
    key: "production",
    title: "Production runs",
    rule: "A production run belongs to one credit batch, so its diesel and electricity go to that batch in full.",
  },
  {
    key: "deliveryTransport",
    title: "Biochar delivery transport",
    rule: "A biochar delivery is split by the biochar mass each credit batch has on the load.",
  },
  {
    key: "manual",
    title: "Manual entries",
    rule: "A manual entry is recorded on one credit batch and stays with it in full.",
  },
];

// ---------------------------------------------------------------------------
// Raw records
// ---------------------------------------------------------------------------

const RUNS: { code: string; date: string; batch: BatchCode; dieselL: number; electricityKwh: number }[] = [
  { code: "PR-26-001", date: "2026-02-04", batch: "CB-26-001", dieselL: 22, electricityKwh: 168 },
  { code: "PR-26-002", date: "2026-02-12", batch: "CB-26-001", dieselL: 19, electricityKwh: 172 },
  { code: "PR-26-003", date: "2026-02-23", batch: "CB-26-001", dieselL: 26, electricityKwh: 181 },
  { code: "PR-26-004", date: "2026-03-03", batch: "CB-26-002", dieselL: 21, electricityKwh: 165 },
  { code: "PR-26-005", date: "2026-03-11", batch: "CB-26-002", dieselL: 24, electricityKwh: 190 },
  { code: "PR-26-006", date: "2026-03-24", batch: "CB-26-002", dieselL: 18, electricityKwh: 158 },
  { code: "PR-26-007", date: "2026-04-06", batch: "CB-26-003", dieselL: 23, electricityKwh: 176 },
  { code: "PR-26-008", date: "2026-04-15", batch: "CB-26-003", dieselL: 20, electricityKwh: 169 },
];

const RUN_BY_CODE = new Map(RUNS.map((run) => [run.code, run]));

/** Feedstock deliveries, the wet mass each run drew from them (bin FIFO), and mass that left without a run. */
const FEEDSTOCKS: {
  code: string;
  date: string;
  bin: string;
  supplier: string;
  wetKg: number;
  oneWayKm: number;
  draws: { run: string; kg: number }[];
  out?: MassOut[];
}[] = [
  {
    code: "FS-26-001", date: "2026-02-02", bin: "North bay", supplier: "Mufindi Sawmill", wetKg: 10_000, oneWayKm: 42,
    draws: [{ run: "PR-26-001", kg: 4_000 }, { run: "PR-26-002", kg: 4_000 }, { run: "PR-26-004", kg: 2_000 }],
  },
  {
    code: "FS-26-002", date: "2026-02-18", bin: "South bay", supplier: "Iringa Timber", wetKg: 8_000, oneWayKm: 65,
    draws: [{ run: "PR-26-003", kg: 4_500 }, { run: "PR-26-005", kg: 3_500 }],
  },
  {
    code: "FS-26-003", date: "2026-03-01", bin: "North bay", supplier: "Mufindi Sawmill", wetKg: 9_000, oneWayKm: 42,
    draws: [{ run: "PR-26-004", kg: 2_500 }, { run: "PR-26-006", kg: 4_500 }, { run: "PR-26-007", kg: 2_000 }],
  },
  {
    code: "FS-26-004", date: "2026-03-09", bin: "South bay", supplier: "Njombe Forest Products", wetKg: 6_000, oneWayKm: 118,
    draws: [{ run: "PR-26-005", kg: 1_000 }, { run: "PR-26-007", kg: 2_500 }, { run: "PR-26-008", kg: 2_000 }],
  },
  {
    code: "FS-26-005", date: "2026-04-10", bin: "North bay", supplier: "Mufindi Sawmill", wetKg: 11_000, oneWayKm: 42,
    draws: [{ run: "PR-26-008", kg: 2_500 }],
  },
  {
    code: "FS-26-006", date: "2026-03-14", bin: "East bay", supplier: "Iringa Timber", wetKg: 4_000, oneWayKm: 65,
    draws: [],
    out: [{ kind: "lost", date: "2026-03-27", kg: 1_000 }],
  },
  {
    code: "FS-26-007", date: "2026-04-24", bin: "East bay", supplier: "Iringa Timber", wetKg: 5_000, oneWayKm: 65,
    draws: [],
  },
];

/** Biochar deliveries: the product mass each credit batch has on the load. */
const DELIVERIES: { code: string; date: string; customer: string; oneWayKm: number; loads: { batch: BatchCode; kg: number }[] }[] = [
  { code: "DL-26-001", date: "2026-03-02", customer: "Kilolo Farmers Group", oneWayKm: 36, loads: [{ batch: "CB-26-001", kg: 3_200 }] },
  { code: "DL-26-002", date: "2026-03-20", customer: "Mafinga Estate", oneWayKm: 54, loads: [{ batch: "CB-26-002", kg: 2_800 }] },
  { code: "DL-26-003", date: "2026-04-08", customer: "Ruaha Growers", oneWayKm: 88, loads: [{ batch: "CB-26-001", kg: 1_200 }, { batch: "CB-26-002", kg: 2_800 }] },
  { code: "DL-26-004", date: "2026-04-28", customer: "Kilolo Farmers Group", oneWayKm: 36, loads: [{ batch: "CB-26-003", kg: 2_400 }] },
];

const MANUAL: { id: string; name: string; date: string; batch: BatchCode; quantity: Quantity }[] = [
  { id: "ME-1", name: "Loader diesel", date: "2026-02-27", batch: "CB-26-001", quantity: { value: 46, unit: "L", label: "Diesel" } },
  { id: "ME-2", name: "Chipper electricity", date: "2026-03-30", batch: "CB-26-002", quantity: { value: 310, unit: "kWh", label: "Electricity" } },
];

const KG_PER_TONNE = 1000;

function tonneKm(kg: number, oneWayKm: number): number {
  return (kg / KG_PER_TONNE) * countedRoundTripKm(oneWayKm);
}

const kgFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const quantityFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export function formatValue(value: number, unit: Unit): string {
  return `${quantityFormat.format(value)} ${unit}`;
}

export function formatQuantity(quantity: Quantity): string {
  return formatValue(quantity.value, quantity.unit);
}

export function formatQuantities(quantities: Quantity[], fraction = 1): string {
  return quantities.map((quantity) => formatValue(quantity.value * fraction, quantity.unit)).join(", ");
}

export function formatKg(kg: number): string {
  return `${kgFormat.format(kg)} kg`;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function formatDay(date: string): string {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

export function ownerName(owner: Owner): string {
  return owner.notYet ? NOT_YET_LABEL : owner.label;
}

// ---------------------------------------------------------------------------
// Build the records
// ---------------------------------------------------------------------------

/** The credit batch whose production period holds a date (the first, if periods overlap). */
export function batchOn(date: string): Batch | undefined {
  return BATCHES.find((batch) => batch.startDate <= date && date <= batch.endDate);
}

function feedstockUse(feedstock: (typeof FEEDSTOCKS)[number]): FeedstockUse {
  const used: BatchUse[] = [];
  for (const draw of feedstock.draws) {
    const run = RUN_BY_CODE.get(draw.run);
    if (!run) throw new Error(`Run ${draw.run} is missing`);
    const entry = used.find((candidate) => candidate.batch === run.batch);
    if (entry) {
      entry.kg += draw.kg;
      if (!entry.runs.includes(run.code)) entry.runs.push(run.code);
    } else used.push({ batch: run.batch, kg: draw.kg, runs: [run.code] });
  }
  const out = feedstock.out ?? [];
  const goneKg = [...feedstock.draws, ...out].reduce((sum, item) => sum + item.kg, 0);
  const first = feedstock.draws.map((draw) => RUN_BY_CODE.get(draw.run)!).sort((a, b) => a.date.localeCompare(b.date))[0];
  const firstOut = [...out].sort((a, b) => a.date.localeCompare(b.date))[0];
  const periodBatch = firstOut ? batchOn(firstOut.date) : undefined;
  const base = { bin: feedstock.bin, wetKg: feedstock.wetKg, tonneKm: tonneKm(feedstock.wetKg, feedstock.oneWayKm), used, out, stillKg: feedstock.wetKg - goneKg };
  if (first) return { ...base, firstRun: { code: first.code, date: first.date, batch: first.batch }, owner: first.batch, reason: "firstRun" };
  if (periodBatch) return { ...base, owner: periodBatch.code, reason: "leftInPeriod" };
  return { ...base, owner: null, reason: "notYet" };
}

export const OUT_WORDS: Record<MassOut["kind"], string> = {
  lost: "lost",
  withdrawn: "withdrawn",
  failedRun: "drawn by a failed run",
};

function feedstockRecords(): SourceRecord[] {
  return FEEDSTOCKS.map((feedstock) => {
    const use = feedstockUse(feedstock);
    const parts: Part[] = use.owner
      ? [{
          key: use.owner,
          fraction: 1,
          basis: [
            use.firstRun
              ? { label: `${use.firstRun.code} drew first`, kg: null }
              : { label: `${formatKg(use.out[0].kg)} ${OUT_WORDS[use.out[0].kind]} ${formatDay(use.out[0].date)}`, kg: null },
          ],
        }]
      : [{ key: NOT_YET, fraction: 1, basis: [{ label: `Still in ${feedstock.bin}`, kg: feedstock.wetKg }] }];
    return {
      id: feedstock.code,
      code: feedstock.code,
      group: "feedstockTransport",
      date: feedstock.date,
      detail: `${feedstock.bin}, ${kgFormat.format(feedstock.wetKg)} kg wet, ${feedstock.oneWayKm} km`,
      quantities: [{ value: use.tonneKm, unit: "t·km", label: "Transport" }],
      parts,
      basisWord: "the first run that drew from it",
      feedstock: use,
    };
  });
}

function runRecords(): SourceRecord[] {
  return RUNS.map((run) => ({
    id: run.code,
    code: run.code,
    group: "production",
    date: run.date,
    detail: `Reactor 1`,
    quantities: [
      { value: run.dieselL, unit: "L", label: "Diesel" },
      { value: run.electricityKwh, unit: "kWh", label: "Electricity" },
    ],
    parts: [{ key: run.batch, fraction: 1, basis: [{ label: run.code, kg: null }] }],
    basisWord: "the run",
  }));
}

function deliveryRecords(): SourceRecord[] {
  return DELIVERIES.map((delivery) => {
    const totalKg = delivery.loads.reduce((sum, load) => sum + load.kg, 0);
    return {
      id: delivery.code,
      code: delivery.code,
      group: "deliveryTransport",
      date: delivery.date,
      detail: `${delivery.customer}, ${kgFormat.format(totalKg)} kg, ${delivery.oneWayKm} km`,
      quantities: [{ value: tonneKm(totalKg, delivery.oneWayKm), unit: "t·km", label: "Transport" }],
      parts: delivery.loads.map((load) => ({ key: load.batch, fraction: load.kg / totalKg, basis: [{ label: `${load.batch} biochar`, kg: load.kg }] })),
      basisWord: "biochar on the load",
    };
  });
}

function manualRecords(): SourceRecord[] {
  return MANUAL.map((entry) => ({
    id: entry.id,
    code: entry.name,
    group: "manual",
    date: entry.date,
    detail: `Manual entry on ${entry.batch}`,
    quantities: [entry.quantity],
    parts: [{ key: entry.batch, fraction: 1, basis: [{ label: "Recorded on the batch", kg: null }] }],
    basisWord: "the batch it was recorded on",
  }));
}

export const RECORDS: SourceRecord[] = [...feedstockRecords(), ...runRecords(), ...deliveryRecords(), ...manualRecords()];

export function recordsOf(group: GroupKey): SourceRecord[] {
  return RECORDS.filter((record) => record.group === group);
}

// ---------------------------------------------------------------------------
// Removals: two fixtures, one batch each or RM-26-002 holding two
// ---------------------------------------------------------------------------

export type RemovalFixture = "one" | "two";

export interface Removal {
  code: string;
  batches: BatchCode[];
  status: string;
}

export const REMOVALS: Record<RemovalFixture, Removal[]> = {
  one: [
    { code: "RM-26-001", batches: ["CB-26-001"], status: "Submitted" },
    { code: "RM-26-002", batches: ["CB-26-002"], status: "Ready to submit" },
    { code: "RM-26-003", batches: ["CB-26-003"], status: "Not submitted" },
  ],
  two: [
    { code: "RM-26-001", batches: ["CB-26-001"], status: "Submitted" },
    { code: "RM-26-002", batches: ["CB-26-002", "CB-26-003"], status: "Ready to submit" },
  ],
};

// ---------------------------------------------------------------------------
// The allocation view model: one "owner" per column (a batch, or a Removal)
// ---------------------------------------------------------------------------

/** A column of the allocation: one credit batch, one Removal, or not yet allocated. */
export interface Owner {
  key: string;
  label: string;
  /** Second line: the batch month, or the Removal's batches. */
  sub: string;
  batches: BatchCode[];
  notYet?: boolean;
}

export type Surface = "batch" | "removal";

export interface Focus {
  surface: Surface;
  /** The batch or Removal the page is about. */
  owner: Owner;
  owners: Owner[];
}

export const NOT_YET_LABEL = "Not yet allocated";

export const NOT_YET_OWNER: Owner = { key: NOT_YET, label: NOT_YET_LABEL, sub: "Nothing used yet", batches: [], notYet: true };

export function batchOwners(): Owner[] {
  return BATCHES.map((batch) => ({ key: batch.code, label: batch.code, sub: batch.month, batches: [batch.code] }));
}

export function removalOwners(fixture: RemovalFixture): Owner[] {
  return REMOVALS[fixture].map((removal) => ({ key: removal.code, label: removal.code, sub: removal.batches.join(", "), batches: removal.batches }));
}

export function focusFor(surface: Surface, key: string, fixture: RemovalFixture): Focus {
  const owners = surface === "batch" ? batchOwners() : removalOwners(fixture);
  const owner = owners.find((candidate) => candidate.key === key) ?? owners[surface === "batch" ? 0 : 1] ?? owners[0];
  return { surface, owner, owners };
}

/** The share of a record one owner carries (0 to 1). */
export function fractionFor(record: SourceRecord, owner: Owner): number {
  if (owner.notYet) return record.parts.filter((part) => part.key === NOT_YET).reduce((sum, part) => sum + part.fraction, 0);
  return record.parts.filter((part) => part.key !== NOT_YET && owner.batches.includes(part.key)).reduce((sum, part) => sum + part.fraction, 0);
}

export function basisFor(record: SourceRecord, owner: Owner): PartBasis[] {
  return record.parts
    .filter((part) => (owner.notYet ? part.key === NOT_YET : part.key !== NOT_YET && owner.batches.includes(part.key)))
    .flatMap((part) => part.basis);
}

/** Owners with a share of this record, in column order, Not yet allocated last. */
export function sharesOf(record: SourceRecord, owners: Owner[]): { owner: Owner; fraction: number; percent: number }[] {
  const all = [...owners, NOT_YET_OWNER].map((owner) => ({ owner, fraction: fractionFor(record, owner) })).filter((share) => share.fraction > 0);
  const percents = wholePercents(all.map((share) => share.fraction));
  return all.map((share, index) => ({ ...share, percent: percents[index] }));
}

/** Whole percents that always add to 100 (largest remainder), so a row never reads 99% or 101%. */
export function wholePercents(fractions: number[]): number[] {
  const PERCENT = 100;
  const raw = fractions.map((fraction) => fraction * PERCENT);
  const floors = raw.map(Math.floor);
  let left = PERCENT - floors.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** The one percent shown for an owner's share of a record, matching the record's row. */
export function percentFor(record: SourceRecord, owner: Owner, owners: Owner[]): number {
  return sharesOf(record, owners).find((share) => share.owner.key === owner.key)?.percent ?? 0;
}

/** Records this owner carries any part of. */
export function recordsCarriedBy(owner: Owner, group?: GroupKey): SourceRecord[] {
  return RECORDS.filter((record) => (!group || record.group === group) && fractionFor(record, owner) > 0);
}

/** Totals per unit for one owner in one group, e.g. [{ 1,257 t·km }]. */
export function totalsFor(owner: Owner, group: GroupKey): Quantity[] {
  const byUnit = new Map<string, Quantity>();
  for (const record of recordsOf(group)) {
    const fraction = fractionFor(record, owner);
    if (fraction <= 0) continue;
    for (const quantity of record.quantities) {
      const key = `${quantity.label}|${quantity.unit}`;
      const previous = byUnit.get(key);
      byUnit.set(key, { ...quantity, value: (previous?.value ?? 0) + quantity.value * fraction });
    }
  }
  return [...byUnit.values()];
}

/** Totals per unit of a whole group (every record in full). */
export function groupTotals(group: GroupKey): Quantity[] {
  const byUnit = new Map<string, Quantity>();
  for (const record of recordsOf(group)) {
    for (const quantity of record.quantities) {
      const key = `${quantity.label}|${quantity.unit}`;
      const previous = byUnit.get(key);
      byUnit.set(key, { ...quantity, value: (previous?.value ?? 0) + quantity.value });
    }
  }
  return [...byUnit.values()];
}

// ---------------------------------------------------------------------------
// Hints: why a page carries a whole delivery, or none of one it drew from
// ---------------------------------------------------------------------------

/** Where the rest of a delivery went, seen from one page. */
export type RestPart =
  | { kind: "batch"; batch: BatchCode; kg: number }
  | { kind: "out"; out: MassOut }
  | { kind: "still"; bin: string; kg: number };

export type FeedstockHint =
  /** (a) Carries the whole leg, but its runs drew only part of the delivery. */
  | { kind: "partly"; record: SourceRecord; use: FeedstockUse; usedKg: number; rest: RestPart[] }
  /** (b) Carries the whole leg though no run drew from it: mass left the bin in its period. */
  | { kind: "noRun"; record: SourceRecord; use: FeedstockUse; out: MassOut }
  /** Receiving side: its runs drew from the delivery, another batch carries it. */
  | { kind: "countedOn"; record: SourceRecord; use: FeedstockUse; usedKg: number; countedOn: BatchCode };

export function usedBy(use: FeedstockUse, owner: Owner): number {
  return use.used.filter((entry) => owner.batches.includes(entry.batch)).reduce((sum, entry) => sum + entry.kg, 0);
}

export function feedstockHint(record: SourceRecord, owner: Owner): FeedstockHint | null {
  const use = record.feedstock;
  if (!use || owner.notYet) return null;
  const usedKg = usedBy(use, owner);
  const carries = !!use.owner && owner.batches.includes(use.owner);
  if (!carries) return use.owner && usedKg > 0 ? { kind: "countedOn", record, use, usedKg, countedOn: use.owner } : null;
  if (use.reason === "leftInPeriod") return { kind: "noRun", record, use, out: use.out[0] };
  if (usedKg >= use.wetKg) return null;
  const rest: RestPart[] = [
    ...use.used.filter((entry) => !owner.batches.includes(entry.batch)).map((entry) => ({ kind: "batch" as const, batch: entry.batch, kg: entry.kg })),
    ...use.out.map((out) => ({ kind: "out" as const, out })),
    ...(use.stillKg > 0 ? [{ kind: "still" as const, bin: use.bin, kg: use.stillKg }] : []),
  ];
  return { kind: "partly", record, use, usedKg, rest };
}

/** Every feedstock hint for one page, in record order. */
export function feedstockHints(owner: Owner): FeedstockHint[] {
  return recordsOf("feedstockTransport")
    .map((record) => feedstockHint(record, owner))
    .filter((hint): hint is FeedstockHint => hint != null);
}
