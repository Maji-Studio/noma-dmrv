/**
 * PROTOTYPE (epic #1058 PR 3, throwaway branch `prototype/emissions-variants`).
 *
 * In-memory stub of the batch emission lines read model. Line names,
 * groups and descriptions come from the sandbox "Dark Earth Carbon Template
 * (15 Oct)" (tests/fixtures/isometric/sandbox-template-2026-10-15.json, with
 * Cula's CO and CH4 descriptions). The shape follows
 * `src/lib/read-models/batch-emission-lines.ts` (emissions-pr3 branch) and the
 * labels in `src/lib/certification/emission-lines.ts`, plus one proposed
 * state, `nothingToRecord`, from Kenji's 2026-10-16 answers.
 *
 * Nothing here touches the database. Mutations replace module state and
 * notify subscribers, so a reload starts over.
 */
import { useSyncExternalStore } from "react";
import { EMISSION_LINE_STATE_LABELS, type EmissionLineState } from "@/lib/certification/emission-lines";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";

export const PROTOTYPE_TEMPLATE_NAME = "Dark Earth Carbon Template (15 Oct)";
const KG_PER_TONNE = 1000;
const STUB_DRY_FEEDSTOCK_T = 1184.6;
const STUB_RUNS = 22;

/** The plan's states plus the proposed operator answer for an empty line. */
export type PrototypeLineState = EmissionLineState | "nothingToRecord";
export const PROTOTYPE_STATE_LABELS: Record<PrototypeLineState, string> = {
  ...EMISSION_LINE_STATE_LABELS,
  nothingToRecord: "Nothing to record",
};
/** Lines the operator still has to act on. The batch sheet panel lists these. */
export const OPEN_STATES: readonly PrototypeLineState[] = ["needsReview", "missingEvidence", "empty", "needsSetup"];

export type LineShape = "value" | "massDistance" | "gas" | "records";
export type EntryRule = "additive" | "single" | "none";

export interface LineDef {
  id: string;
  name: string;
  group: string;
  description: string;
  shape: LineShape;
  rule: EntryRule;
  /** Template input name, sentence case. */
  inputLabel: string;
  unit: string;
  /** Where the automatic figure comes from, when the line has one. */
  recordsLabel?: string;
  /** Lines whose evidence is the facility's yearly emissions test report. */
  yearlyReport?: boolean;
  /** Counts in the facility activity totals. */
  activity?: "diesel" | "electricity";
}

export const GAS_INPUTS = [
  { key: "concentration", label: "Concentration in emitted gas", unit: "mg/kg" },
  { key: "massFlow", label: "Total mass flow of gas", unit: "kg" },
] as const;

const GAS_DESCRIPTION = (gas: string) =>
  `${gas} emissions from the emissions test done during FAT, highest value converted to ppm and then 100% uncertainty applied.\nThe direct ${gas} emissions are assigned for each reporting period based on the amount of dry biomass used.\nThe annual mass flow of the gas (36,792 t) is based on an estimated 17,520 t of dry feedstock, so the mass flow for each reporting period is:\nReporting period mass flow = reporting period dry feedstock (t) × (36,792 t / 17,520 t).`;

export const LINE_DEFS: readonly LineDef[] = [
  { id: "feedTruck", name: "Biomass transportations to processing site via truck", group: "Biomass feedstock transport", shape: "massDistance", rule: "additive", inputLabel: "Mass multiplied by distance", unit: "t·km", recordsLabel: "Feedstock transport legs", description: "Transport of biomass from sourcing locations, determined from actuals using prior production." },
  { id: "meterElec", name: "Metered electricity use emissions", group: "Pyrolysis", shape: "value", rule: "additive", inputLabel: "Total electricity usage", unit: "kWh", recordsLabel: "Production runs", activity: "electricity", description: "Electricity usage emissions from total site. Emission factor sourced from https://unfccc.int/documents/198197 on 2025-11-15.\nAll electricity consumption is assigned to the Pyrolysis section, because it cannot be split by production step." },
  { id: "genset", name: "Generator diesel usage", group: "Pyrolysis", shape: "value", rule: "additive", inputLabel: "Volume of fuel", unit: "L", recordsLabel: "Production runs", activity: "diesel", description: "Fuel used by the diesel genset in case of power cuts. 2.7 kgCO₂e per litre of diesel combusted (IPCC 2006 stationary combustion defaults)." },
  { id: "startup", name: "Startup diesel usage", group: "Pyrolysis", shape: "value", rule: "additive", inputLabel: "Volume of fuel", unit: "L", recordsLabel: "Production runs", activity: "diesel", description: "Fuel used by diesel burners to start up the machine. 2.7 kgCO₂e per litre of diesel combusted." },
  { id: "ch4", name: "Pyrolyzer CH₄ emissions", group: "Direct emissions", shape: "gas", rule: "single", inputLabel: "Concentration and mass flow", unit: "mg/kg, kg", yearlyReport: true, description: GAS_DESCRIPTION("CH₄") },
  { id: "co", name: "Pyrolyzer CO emissions", group: "Direct emissions", shape: "gas", rule: "single", inputLabel: "Concentration and mass flow", unit: "mg/kg, kg", yearlyReport: true, description: GAS_DESCRIPTION("CO") },
  { id: "biocharTruck", name: "Biochar transportation to storage site via truck", group: "Biochar transport", shape: "massDistance", rule: "additive", inputLabel: "Mass multiplied by distance", unit: "t·km", recordsLabel: "Delivery transport legs", description: "Emissions related to biochar transportation, based on a distance-mass method." },
  { id: "stored", name: "Biochar sequestration, 1000 year durability", group: "CO₂ stored", shape: "records", rule: "none", inputLabel: "CO₂ stored", unit: "t CO₂e", recordsLabel: "Applications and lab results", description: "Carbon sequestered via biochar application to fields." },
  { id: "sampleEU", name: "Mass-distance-based CI emissions samples to EU", group: "Sampling required for MRV", shape: "massDistance", rule: "additive", inputLabel: "Mass multiplied by distance", unit: "t·km", description: "DHL of samples to EU lab. 10 samples per year at 4 kg per sample going 7000 km." },
  { id: "consumables", name: "Sampling consumables", group: "Sampling required for MRV", shape: "value", rule: "additive", inputLabel: "Mass", unit: "kg", description: "Plastic sampling bags and similar. A very conservative estimate, most likely closer to 10 kg of plastic." },
  { id: "labEU", name: "Laboratory analysis electricity use EU", group: "Sampling required for MRV", shape: "value", rule: "additive", inputLabel: "Total electricity usage", unit: "kWh", description: "Estimated electricity usage. Conservative." },
  { id: "labIN", name: "Laboratory analysis electricity use India", group: "Sampling required for MRV", shape: "value", rule: "additive", inputLabel: "Total electricity usage", unit: "kWh", description: "Estimated electricity usage. Conservative." },
  { id: "sampleIN", name: "Mass-distance-based CI emissions samples to India", group: "Sampling required for MRV", shape: "massDistance", rule: "additive", inputLabel: "Mass multiplied by distance", unit: "t·km", description: "DHL of samples to India lab. 10 samples per year at 4 kg per sample going 4600 km." },
  { id: "flights", name: "Staff travel flights", group: "Staff travel", shape: "value", rule: "additive", inputLabel: "Distance traveled", unit: "km", description: "International flights by staff for project requirements, about 3 round trips from Tanzania to Europe per year." },
  { id: "local", name: "Staff travel local", group: "Staff travel", shape: "value", rule: "additive", inputLabel: "Distance traveled", unit: "km", description: "Estimated staff travel for the project. Conservative, as staff mostly use public transport or walk." },
];
const LINE_BY_ID = new Map(LINE_DEFS.map((line) => [line.id, line]));
export function lineDef(id: string): LineDef {
  const line = LINE_BY_ID.get(id);
  if (!line) throw new Error(`Unknown prototype line ${id}`);
  return line;
}

export interface PrototypeEntry {
  id: string;
  lineId: string;
  kind: "value" | "nothing";
  date: string;
  value?: number;
  mass?: number;
  distance?: number;
  concentration?: number;
  massFlow?: number;
  files: string[];
  note: string;
  /** False when the template line changed after this entry was written. */
  counts: boolean;
}

export type Scenario = "fresh" | "open" | "finished";
export interface PrototypeBatch {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: "draft" | "pending" | "verified" | "issued" | "rejected";
  /** True for a credit batch read from the dev DB, false for an in-memory stub. */
  real: boolean;
  scenario: Scenario;
  dryFeedstockT: number;
  runCount: number;
}

interface AutoFigure { value: number; detail: string }
const RICH_AUTO: Record<string, AutoFigure> = {
  feedTruck: { value: 52836, detail: "14 legs" },
  meterElec: { value: 18420, detail: `${STUB_RUNS} production runs` },
  genset: { value: 120, detail: `${STUB_RUNS} production runs` },
  startup: { value: 640, detail: `${STUB_RUNS} production runs` },
  biocharTruck: { value: 11940, detail: "4 deliveries" },
  stored: { value: 2140.6, detail: "31 applications" },
};
const FRESH_SCALE = 0.4;
const FINISHED_SCALE = 0.95;

function scaledAuto(scale: number, without: string[] = []): Record<string, AutoFigure> {
  return Object.fromEntries(
    Object.entries(RICH_AUTO)
      .filter(([id]) => !without.includes(id))
      .map(([id, figure]) => [id, { value: Math.round(figure.value * scale * 10) / 10, detail: figure.detail }]),
  );
}
export function autoFigures(batch: PrototypeBatch): Record<string, AutoFigure> {
  if (batch.scenario === "open") return RICH_AUTO;
  // A fresh batch has runs but no deliveries or applications yet.
  if (batch.scenario === "fresh") return scaledAuto(FRESH_SCALE, ["biocharTruck", "stored"]);
  return scaledAuto(FINISHED_SCALE);
}

/** Lines the batch's template cannot take entries for yet. */
export function setupLines(batch: PrototypeBatch): string[] {
  return batch.scenario === "fresh" ? ["local"] : [];
}

function dayIn(batch: PrototypeBatch, dayOfMonth: number): string {
  return `${batch.startDate.slice(0, 8)}${String(dayOfMonth).padStart(2, "0")}`;
}
const monthName = (batch: PrototypeBatch) =>
  new Date(`${batch.startDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

function seedEntries(batch: PrototypeBatch): PrototypeEntry[] {
  const e = (id: string, entry: Omit<PrototypeEntry, "id" | "counts" | "note" | "files"> & Partial<PrototypeEntry>): PrototypeEntry => ({
    id: `${batch.id}-${id}`, counts: true, note: "", files: [], ...entry,
  });
  if (batch.scenario === "fresh") return [];
  if (batch.scenario === "open") {
    return [
      e("e1", { lineId: "meterElec", kind: "value", date: dayIn(batch, 28), value: 1150, files: ["TANESCO-bill.pdf"], note: "Workshop and office meter, monthly bill" }),
      e("e2", { lineId: "genset", kind: "value", date: dayIn(batch, 18), value: 45, note: "Power cut, genset refuelled from the drum" }),
      e("e3", { lineId: "co", kind: "value", date: dayIn(batch, 2), concentration: 412, massFlow: 2487660, files: ["emissions-test-report-2026.pdf"] }),
      e("e4", { lineId: "consumables", kind: "value", date: dayIn(batch, 12), value: 2.4, files: ["sampling-bags-receipt.jpg"], note: "Sample bags and labels for 3 Samples" }),
      e("e5", { lineId: "labEU", kind: "value", date: dayIn(batch, 20), value: 22, files: ["lab-eu-statement.pdf"] }),
      e("e6", { lineId: "labIN", kind: "value", date: dayIn(batch, 26), value: 38, files: ["lab-india-statement.pdf"], counts: false }),
      e("e7", { lineId: "sampleIN", kind: "value", date: dayIn(batch, 24), mass: 12, distance: 4600, files: ["DHL-waybill-4471.pdf"], note: "3 Samples in one parcel" }),
      e("e8", { lineId: "flights", kind: "nothing", date: dayIn(batch, 28), note: `No staff flights in ${monthName(batch)}` }),
      e("e9", { lineId: "local", kind: "value", date: dayIn(batch, 15), value: 180, files: ["travel-log.xlsx"] }),
    ];
  }
  return [
    e("f1", { lineId: "ch4", kind: "value", date: dayIn(batch, 3), concentration: 96, massFlow: 2310400, files: ["emissions-test-report-2026.pdf"] }),
    e("f2", { lineId: "co", kind: "value", date: dayIn(batch, 3), concentration: 398, massFlow: 2310400, files: ["emissions-test-report-2026.pdf"] }),
    e("f3", { lineId: "sampleEU", kind: "value", date: dayIn(batch, 9), mass: 8, distance: 7000, files: ["DHL-waybill-4402.pdf"] }),
    e("f4", { lineId: "sampleIN", kind: "nothing", date: dayIn(batch, 28), note: "No samples sent to India this month" }),
    e("f5", { lineId: "consumables", kind: "value", date: dayIn(batch, 9), value: 1.8, files: ["sampling-bags-receipt.jpg"] }),
    e("f6", { lineId: "labEU", kind: "value", date: dayIn(batch, 21), value: 19, files: ["lab-eu-statement.pdf"] }),
    e("f7", { lineId: "labIN", kind: "nothing", date: dayIn(batch, 28), note: "No India lab analysis this month" }),
    e("f8", { lineId: "flights", kind: "nothing", date: dayIn(batch, 28), note: `No staff flights in ${monthName(batch)}` }),
    e("f9", { lineId: "local", kind: "value", date: dayIn(batch, 14), value: 140, files: ["travel-log.xlsx"] }),
  ];
}

/* ---------- store ---------- */

interface StoreState {
  entries: Record<string, PrototypeEntry[]>;
  lastAction: string;
  version: number;
}
let state: StoreState = { entries: {}, lastAction: "Opened the prototype", version: 0 };
const listeners = new Set<() => void>();
let nextEntryNo = 100;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function commit(next: Omit<StoreState, "version">) {
  state = { ...next, version: state.version + 1 };
  for (const listener of listeners) listener();
}
export function usePrototypeStore(): StoreState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
export function entriesFor(store: StoreState, batch: PrototypeBatch): PrototypeEntry[] {
  return store.entries[batch.id] ?? seedEntries(batch);
}

function writeEntries(batch: PrototypeBatch, update: (entries: PrototypeEntry[]) => PrototypeEntry[], action: string) {
  commit({ entries: { ...state.entries, [batch.id]: update(entriesFor(state, batch)) }, lastAction: `${batch.code}: ${action}` });
}

export type EntryDraft = Omit<PrototypeEntry, "id" | "lineId" | "counts">;
export const prototypeActions = {
  addEntry(batch: PrototypeBatch, lineId: string, draft: EntryDraft, replaceIds: string[] = []) {
    const entry: PrototypeEntry = { ...draft, id: `${batch.id}-n${nextEntryNo++}`, lineId, counts: true };
    const verb = draft.kind === "nothing" ? "Nothing to record" : replaceIds.length ? "Entered again" : "Added entry";
    writeEntries(batch, (entries) => [...entries.filter((e) => !replaceIds.includes(e.id)), entry], `${verb} on ${lineDef(lineId).name}`);
  },
  updateEntry(batch: PrototypeBatch, entryId: string, draft: EntryDraft) {
    const line = entriesFor(state, batch).find((e) => e.id === entryId);
    writeEntries(batch, (entries) => entries.map((e) => (e.id === entryId ? { ...e, ...draft } : e)), `Saved entry on ${line ? lineDef(line.lineId).name : "a line"}`);
  },
  confirm(batch: PrototypeBatch, lineId: string) {
    writeEntries(batch, (entries) => entries.map((e) => (e.lineId === lineId ? { ...e, counts: true } : e)), `Confirmed ${lineDef(lineId).name}`);
  },
  reset() {
    commit({ entries: {}, lastAction: "Reset the stub data" });
  },
};

/* ---------- derivation ---------- */

export interface PrototypeLine {
  def: LineDef;
  state: PrototypeLineState;
  open: boolean;
  auto: AutoFigure | null;
  entries: PrototypeEntry[];
  /** Counting value entries. */
  values: PrototypeEntry[];
  /** Entries that stopped counting after a template change. */
  review: PrototypeEntry[];
  nothing: PrototypeEntry | null;
  /** Scalar total in the line unit; null for paired inputs or nothing yet. */
  total: number | null;
  totalText: string;
}

export function entryAmount(line: LineDef, entry: PrototypeEntry): number {
  if (line.shape === "massDistance" && entry.mass != null && entry.distance != null) {
    return (entry.mass * entry.distance) / KG_PER_TONNE;
  }
  return entry.value ?? 0;
}

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}
export function formatFigure(value: number, unit: string): string {
  return `${formatNumber(value)} ${unit}`;
}
export function entryText(line: LineDef, entry: PrototypeEntry): string {
  if (entry.kind === "nothing") return "Nothing to record";
  if (line.shape === "gas") {
    return `${formatNumber(entry.concentration ?? 0)} mg/kg, ${formatNumber(entry.massFlow ?? 0, 0)} kg`;
  }
  if (line.shape === "massDistance") {
    return `${formatNumber(entry.mass ?? 0)} kg over ${formatNumber(entry.distance ?? 0, 0)} km (${formatFigure(entryAmount(line, entry), line.unit)})`;
  }
  return formatFigure(entry.value ?? 0, line.unit);
}

export function deriveLines(batch: PrototypeBatch, entries: PrototypeEntry[]): PrototypeLine[] {
  const auto = autoFigures(batch);
  const setup = setupLines(batch);
  return LINE_DEFS.map((def) => {
    const lineEntries = entries.filter((entry) => entry.lineId === def.id);
    const counting = lineEntries.filter((entry) => entry.counts);
    const values = counting.filter((entry) => entry.kind === "value");
    const review = lineEntries.filter((entry) => !entry.counts);
    const nothing = counting.find((entry) => entry.kind === "nothing") ?? null;
    const figure = auto[def.id] ?? null;
    let lineState: PrototypeLineState;
    if (setup.includes(def.id)) lineState = "needsSetup";
    else if (review.length && !values.length) lineState = "needsReview";
    else if (values.some((entry) => entry.files.length === 0)) lineState = "missingEvidence";
    else if (figure || values.length) lineState = "filled";
    else if (nothing) lineState = "nothingToRecord";
    else lineState = "empty";
    const total =
      def.shape === "gas" || (!figure && !values.length)
        ? null
        : (figure?.value ?? 0) + values.reduce((sum, entry) => sum + entryAmount(def, entry), 0);
    let totalText: string;
    if (def.shape === "gas" && values.length) totalText = entryText(def, values[0]);
    else if (total != null) totalText = formatFigure(total, def.unit);
    else if (lineState === "nothingToRecord") totalText = `0 ${def.unit}`;
    else totalText = PROTOTYPE_STATE_LABELS.empty;
    return {
      def, state: lineState, open: OPEN_STATES.includes(lineState), auto: figure,
      entries: lineEntries, values, review, nothing, total, totalText,
    };
  });
}

export function openLines(lines: PrototypeLine[]): PrototypeLine[] {
  const order = (line: PrototypeLine) => OPEN_STATES.indexOf(line.state);
  return lines.filter((line) => line.open).sort((a, b) => order(a) - order(b));
}

export function stateCounts(lines: PrototypeLine[]): Record<PrototypeLineState, number> {
  const counts = Object.fromEntries(Object.keys(PROTOTYPE_STATE_LABELS).map((key) => [key, 0])) as Record<PrototypeLineState, number>;
  for (const line of lines) counts[line.state] += 1;
  return counts;
}

/** Litres and kWh per facility: run figures plus entries (Kenji, answer 6). */
export function activityTotals(batches: { batch: PrototypeBatch; lines: PrototypeLine[] }[]) {
  const rows = LINE_DEFS.filter((def) => def.activity).map((def) => {
    let fromRecords = 0;
    let fromEntries = 0;
    for (const { lines } of batches) {
      const line = lines.find((l) => l.def.id === def.id);
      if (!line) continue;
      fromRecords += line.auto?.value ?? 0;
      fromEntries += line.values.reduce((sum, entry) => sum + entryAmount(def, entry), 0);
    }
    return { def, fromRecords, fromEntries, total: fromRecords + fromEntries };
  });
  return rows;
}

/* ---------- batches: real ones from the dev DB, padded with stubs ---------- */

function shiftMonth(day: string, months: number): string {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}
function monthEnd(firstDay: string): string {
  const date = new Date(`${firstDay}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}
const MONTHS_PER_YEAR = 12;
/** CB-26-004 → CB-26-005 / CB-26-003; CB-26-001 → CB-25-012 going back. */
function stubCode(code: string, offset: number): string {
  const match = /^(.*-)(\d{2})-(\d+)$/.exec(code);
  if (!match) return `${code}-${offset > 0 ? "next" : "prev"}`;
  const [, prefix, year, number] = match;
  const next = Number(number) + offset;
  if (next >= 1) return `${prefix}${year}-${String(next).padStart(number.length, "0")}`;
  return `${prefix}${String(Number(year) - 1).padStart(2, "0")}-${String(MONTHS_PER_YEAR).padStart(number.length, "0")}`;
}

/**
 * The three scenarios the prototype needs: one fresh, one with 4 open lines,
 * one finished. Real batches take them newest first; stubs fill the rest.
 */
export function prototypeBatches(real: CreditBatchWithRelations[]): PrototypeBatch[] {
  const sorted = [...real].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const fromReal = sorted.map((batch, index): PrototypeBatch => ({
    id: batch.id, code: batch.code, startDate: batch.startDate, endDate: batch.endDate, status: batch.status, real: true,
    scenario: sorted.length === 1 ? "open" : index === 0 ? "fresh" : index === 1 ? "open" : "finished",
    dryFeedstockT: STUB_DRY_FEEDSTOCK_T, runCount: batch.productionRunCount,
  }));
  const anchor = fromReal.find((batch) => batch.scenario === "open") ?? fromReal[0];
  const anchorCode = anchor?.code ?? "CB-26-004";
  const anchorStart = anchor?.startDate ?? "2026-09-01";
  const stubs: PrototypeBatch[] = [];
  if (!fromReal.some((batch) => batch.scenario === "fresh")) {
    const start = shiftMonth(anchorStart, 1);
    stubs.push({ id: "stub-fresh", code: stubCode(anchorCode, 1), startDate: start, endDate: monthEnd(start), status: "draft", real: false, scenario: "fresh", dryFeedstockT: 512.8, runCount: 9 });
  }
  if (!fromReal.some((batch) => batch.scenario === "open")) {
    const start = shiftMonth(anchorStart, 0);
    stubs.push({ id: "stub-open", code: anchorCode, startDate: start, endDate: monthEnd(start), status: "draft", real: false, scenario: "open", dryFeedstockT: STUB_DRY_FEEDSTOCK_T, runCount: STUB_RUNS });
  }
  if (!fromReal.some((batch) => batch.scenario === "finished")) {
    const start = shiftMonth(anchorStart, -1);
    stubs.push({ id: "stub-finished", code: stubCode(anchorCode, -1), startDate: start, endDate: monthEnd(start), status: "pending", real: false, scenario: "finished", dryFeedstockT: 1131.2, runCount: 21 });
  }
  return [...fromReal, ...stubs].sort((a, b) => b.startDate.localeCompare(a.startDate));
}
