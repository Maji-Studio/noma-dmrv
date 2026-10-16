/**
 * Pure vocabulary for the credit batch Emissions page (epic #1058, design C3c
 * "Source chips"). Every surface on the page (row, chips, drawer, add form,
 * bulk grid) reads a line's composition and its copy from here, so the words
 * match: From records + Manual entries = Total.
 *
 * On screen an emissions entry is a "manual entry" (GLOSSARY.md: Emissions
 * entry). Records made on other pages read "From records" with their origin.
 */
import type { EmissionEntry, EmissionLine, LineRecords, RecordsSource } from "@/hooks/use-emission-entries";
import { EMISSION_LINE_STATE_LABELS, type EmissionFigure, type EmissionLineState } from "@/lib/certification/emission-lines";
import { canonicalDecimal, canonicalUnit } from "@/lib/isometric/template-observations/units";
import type { QuantityKind } from "@/lib/isometric/template-observations/types";
import { MISSING_VALUE, pluralize } from "@/lib/copy-utils";

/* ---------- types ---------- */

export type { EmissionEntry, EmissionInput, EmissionLine, LineRecords, RecordsSource } from "@/hooks/use-emission-entries";
export type { EmissionLineState };

/** The credit batch facts the page shows and validates dates against. */
export interface EmissionBatch { creditBatchId: string; code: string; startDate: string; endDate: string | null }

/* ---------- constants ---------- */

const MAX_FRACTION_DIGITS = 3;
const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: MAX_FRACTION_DIGITS });
export const DECIMAL_MESSAGE = "Enter a non-negative decimal value.";
export const DATE_BEFORE_START_MESSAGE = "Entry date cannot be before the credit batch start date.";
export const DATE_IN_FUTURE_MESSAGE = "Entry date cannot be in the future at this facility.";
export const DATE_INVALID_MESSAGE = "Enter a valid entry date.";
export const NEEDS_SETUP_COPY = "noma cannot fill this template line yet. An admin sets it up in the template review.";
export const SINGLE_LINE_CAPTION = "One manual entry per credit batch. It counts for the whole credit batch.";
export const ZERO_SENT_COPY = "Isometric receives 0 for this line. The note stays in noma.";

const OPEN_STATES: readonly EmissionLineState[] = ["needsSetup", "missingEvidence", "needsReview", "empty"];
const DONE_STATES: readonly EmissionLineState[] = ["filled", "confirmedZero"];
/** Most urgent first, then done. */
const STATE_ORDER: readonly EmissionLineState[] = [...OPEN_STATES, "confirmedZero", "filled"];

/* ---------- numbers and units ---------- */

const UNIT_ATOM_DISPLAY: Record<string, string> = { tonne: "t", "m^3": "m³" };
const MASS_ATOMS = new Set(["mg", "g", "kg", "tonne"]);
const DISTANCE_ATOMS = new Set(["m", "km", "mi"]);

export function formatMagnitude(magnitude: string | number): string {
  const value = Number(magnitude);
  return Number.isFinite(value) ? NUMBER_FORMAT.format(value) : MISSING_VALUE.notAvailable;
}

/** "km * tonne" reads "t·km"; "mg / kg" reads "mg/kg"; "tonne" reads "t". */
export function displayUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const atoms = unit.split(" * ");
  const mass = atoms.find((atom) => MASS_ATOMS.has(atom));
  const distance = atoms.find((atom) => DISTANCE_ATOMS.has(atom));
  if (atoms.length === 2 && mass && distance) return `${UNIT_ATOM_DISPLAY[mass] ?? mass}·${distance}`;
  return unit
    .split(" ")
    .map((token) => UNIT_ATOM_DISPLAY[token] ?? token)
    .join(" ")
    .replace(/ \* /g, "·")
    .replace(/ \/ /g, "/");
}

export function formatFigure(figure: EmissionFigure | null | undefined): string {
  if (!figure) return MISSING_VALUE.notRecorded;
  return `${formatMagnitude(figure.magnitude)} ${displayUnit(figure.unit)}`.trim();
}

/** Mass and distance units a mass-distance line takes, from its canonical unit. */
export function massDistanceUnits(unit: string | null): { mass: string; distance: string } | null {
  if (!unit) return null;
  const atoms = unit.split(" * ");
  const mass = atoms.find((atom) => MASS_ATOMS.has(atom));
  const distance = atoms.find((atom) => DISTANCE_ATOMS.has(atom));
  return mass && distance && atoms.length === 2 ? { mass, distance } : null;
}

/**
 * The server's entry decimal rule (ENTRY_DECIMAL_PATTERN and
 * multiplyEntryDecimals in emission-entry-rules). That module pulls node-only
 * template comparison code, so the client keeps this small mirror; the server
 * re-validates every value.
 */
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
export function isDecimal(raw: string): boolean {
  return DECIMAL_PATTERN.test(raw.trim());
}

/** Exact product of two entry decimals, as the server checks it for mass × distance. */
export function multiplyDecimals(a: string, b: string): string {
  const left = canonicalDecimal(a) ?? "0";
  const right = canonicalDecimal(b) ?? "0";
  const scale = (left.split(".")[1]?.length ?? 0) + (right.split(".")[1]?.length ?? 0);
  const digits = (BigInt(left.replace(".", "")) * BigInt(right.replace(".", ""))).toString().padStart(scale + 1, "0");
  return canonicalDecimal(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits) ?? "0";
}

/* ---------- records ---------- */

interface SourceVocabulary { one: string; many: string; shortOne: string; shortMany: string; open: string }
const SOURCE_WORDS: Record<RecordsSource, SourceVocabulary> = {
  productionRuns: { one: "production run", many: "production runs", shortOne: "run", shortMany: "runs", open: "Open production runs" },
  transportLegs: { one: "transport leg", many: "transport legs", shortOne: "leg", shortMany: "legs", open: "Open transport legs" },
  deliveries: { one: "delivery", many: "deliveries", shortOne: "delivery", shortMany: "deliveries", open: "Open deliveries" },
  applications: { one: "application", many: "applications", shortOne: "application", shortMany: "applications", open: "Open applications" },
};

export function lineRecords(line: EmissionLine): LineRecords | null {
  return line.records;
}

/** A records figure above zero. */
export function hasRecordsFigure(records: LineRecords | null): records is LineRecords & { figure: EmissionFigure } {
  return !!records?.figure && Number(records.figure.magnitude) > 0;
}

/** The source exists but holds nothing for this line. */
export function isRecordsGap(records: LineRecords | null): boolean {
  return !!records && !hasRecordsFigure(records);
}

function countWords(count: number, one: string, many: string): string {
  return `${formatMagnitude(count)} ${pluralize(count, one, many)}`;
}

export function openSourceLabel(source: RecordsSource): string {
  return SOURCE_WORDS[source].open;
}

/** Records chip label: "22 runs", "None on 22 runs", "No deliveries yet". */
export function recordsChipText(records: LineRecords): string {
  const words = SOURCE_WORDS[records.source];
  if (hasRecordsFigure(records)) return countWords(records.count, words.shortOne, words.shortMany);
  if (records.count > 0) return `None on ${countWords(records.count, words.shortOne, words.shortMany)}`;
  return `No ${words.many} yet`;
}

/** Full sentence: "120 L from 22 production runs", "Not recorded on 22 production runs", "No deliveries yet". */
export function recordsText(records: LineRecords): string {
  const words = SOURCE_WORDS[records.source];
  const counted = countWords(records.count, words.one, words.many);
  if (hasRecordsFigure(records)) return `${formatFigure(records.figure)} from ${counted}`;
  if (records.count === 0) return `No ${words.many} yet`;
  return `Not recorded on ${counted}`;
}

/** Where the records are made, filtered to the batch where the page supports it. */
export function recordsHref(records: LineRecords, ids: { facilityId: string; creditBatchId: string }): string {
  const params = new URLSearchParams({ facility: ids.facilityId });
  if (records.source !== "transportLegs") params.set("creditBatch", ids.creditBatchId);
  const path = { productionRuns: "/production-runs", transportLegs: "/feedstocks", deliveries: "/deliveries", applications: "/applications" }[records.source];
  return `${path}?${params.toString()}`;
}

/* ---------- entries ---------- */

export function manualEntriesText(count: number): string {
  return countWords(count, "manual entry", "manual entries");
}

/** Counting value entries. */
export function valueEntries(line: EmissionLine): EmissionEntry[] {
  return line.entries.filter((entry) => entry.kind === "value" && entry.counts);
}
/** Entries that stopped counting after a template change (Needs review). */
export function stoppedEntries(line: EmissionLine): EmissionEntry[] {
  return line.entries.filter((entry) => !entry.counts);
}
/** The operator's Nothing to record entry, if any. */
export function nothingEntry(line: EmissionLine): EmissionEntry | null {
  return line.entries.find((entry) => entry.kind === "zero" && entry.counts && entry.confirmedForRemovalId === null) ?? null;
}

export function entryFigureText(entry: EmissionEntry): string {
  return entry.values
    .map((value) => {
      const detail = value.massDistanceDetail;
      const figure = formatFigure({ magnitude: value.magnitude, unit: value.unit });
      if (!detail) return figure;
      return `${formatFigure(detail.mass)} × ${formatFigure(detail.distance)} = ${figure}`;
    })
    .join(", ");
}

/** Sum of counting value entries; null when they hold paired inputs or mixed units. */
export function entriesFigure(line: EmissionLine): EmissionFigure | null {
  const totals = valueEntries(line).map((entry) => entry.total);
  if (!totals.length || totals.some((total) => !total)) return null;
  const unit = totals[0]!.unit;
  if (totals.some((total) => total!.unit !== unit)) return null;
  const sum = totals.reduce((acc, total) => acc + Number(total!.magnitude), 0);
  return { magnitude: String(sum), unit };
}

/** The row Total: the server total, the single entry's pair, a zero, or a missing token. */
export function lineTotalText(line: EmissionLine): string {
  if (line.state === "needsSetup") return EMISSION_LINE_STATE_LABELS.needsSetup;
  if (line.total) return formatFigure(line.total);
  const values = valueEntries(line);
  if (values.length === 1 && values[0].values.length > 1) return entryFigureText(values[0]);
  if (line.state === "confirmedZero") return `0 ${displayUnit(line.unit)}`.trim();
  return MISSING_VALUE.notRecorded;
}

/* ---------- what the operator may do ---------- */

/** Nothing to record applies to the line at all (allowed or refused). */
export function nothingApplies(line: EmissionLine): boolean {
  return line.state !== "needsSetup" && line.entryPolicy !== "none" && line.contract?.scope === "operating" && !nothingEntry(line);
}

/** null when Nothing to record is allowed, else why not. Mirrors the server rule. */
export function nothingRefusal(line: EmissionLine): string | null {
  const values = valueEntries(line).length;
  if (values) return `This line has ${manualEntriesText(values)}.`;
  const records = lineRecords(line);
  if (hasRecordsFigure(records)) return `This line has ${formatFigure(records.figure)} from ${SOURCE_WORDS[records.source].many}.`;
  return null;
}

/** The refused Nothing to record sentence, shared by the row tooltip, the ⋯ menu and the drawer footer. */
export function nothingRefusalText(refusal: string): string {
  return `Nothing to record is not available. ${refusal}`;
}

/** Why Add manual entry is not offered, or null when it is. */
export function addEntryRefusal(line: EmissionLine): string | null {
  if (line.state === "needsSetup" || line.entryPolicy === "none" || line.contract?.scope !== "operating") return "This line takes no manual entries";
  if (line.entryPolicy === "single" && line.entries.some((entry) => entry.kind === "value")) return "One manual entry per credit batch";
  if (!line.inputShape.length || line.inputShape.some((input) => !input.unit)) return "The template units are not read yet";
  return null;
}

export function isOpen(line: EmissionLine): boolean {
  return OPEN_STATES.includes(line.state);
}

/* ---------- filters, sort, groups ---------- */

export const LINE_FILTERS = ["open", "missing", "review", "notRecorded", "done"] as const;
export type LineFilter = (typeof LINE_FILTERS)[number];
export const LINE_SORTS = ["template", "state", "lastEntry"] as const;
export type LineSort = (typeof LINE_SORTS)[number];
export const LINE_SORT_LABELS: Record<LineSort, string> = { template: "Template order", state: "State", lastEntry: "Last entry" };

export function lineMatches(line: EmissionLine, filter: LineFilter | null): boolean {
  switch (filter) {
    case null: return true;
    case "open": return isOpen(line);
    case "missing": return line.state === "missingEvidence";
    case "review": return line.state === "needsReview";
    case "notRecorded": return line.state === "empty";
    case "done": return DONE_STATES.includes(line.state);
  }
}

export function lastEntryOn(line: EmissionLine): string | null {
  return line.entries.reduce<string | null>((latest, entry) => (!latest || entry.occurredOn > latest ? entry.occurredOn : latest), null);
}

export function sortLines(lines: EmissionLine[], sort: LineSort): EmissionLine[] {
  if (sort === "template") return lines;
  return [...lines].sort((a, b) =>
    sort === "state"
      ? STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
      : (lastEntryOn(b) ?? "").localeCompare(lastEntryOn(a) ?? ""),
  );
}

/** "biomass-feedstock-transport" reads "Biomass feedstock transport" until the server sends the name. */
export function groupLabel(line: EmissionLine): string {
  if (line.groupName) return line.groupName;
  const words = line.groupKey.split("-").map((word) => (word === "co2" ? "CO₂" : word === "mrv" ? "MRV" : word));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function groupLines(lines: EmissionLine[]): { key: string; label: string; lines: EmissionLine[] }[] {
  const groups: { key: string; label: string; lines: EmissionLine[] }[] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (last?.key === line.groupKey) last.lines.push(line);
    else groups.push({ key: line.groupKey, label: groupLabel(line), lines: [line] });
  }
  return groups;
}

export interface LineCounts { all: number; open: number; missing: number; review: number; notRecorded: number; done: number }
export function lineCounts(lines: EmissionLine[]): LineCounts {
  const count = (filter: LineFilter | null) => lines.filter((line) => lineMatches(line, filter)).length;
  return { all: lines.length, open: count("open"), missing: count("missing"), review: count("review"), notRecorded: count("notRecorded"), done: count("done") };
}

/* ---------- entry form fields ---------- */

export interface EntryFieldSpec { key: string; label: string; unit: string; inputKey: string; part: "value" | "mass" | "distance" }

const INPUT_LABELS: Partial<Record<QuantityKind, string>> = {
  energy: "Energy used",
  volume: "Volume",
  mass: "Mass",
  distance: "Distance",
  mass_fraction: "Concentration in emitted gas",
};

/** Fields the add form shows for a line, in order. Mass-distance inputs split into mass and distance. */
export function entryFields(line: EmissionLine): EntryFieldSpec[] {
  const gas = line.inputShape.some((input) => input.quantityKind === "mass_fraction");
  return line.inputShape.flatMap((input): EntryFieldSpec[] => {
    if (input.quantityKind === "mass_distance") {
      const units = massDistanceUnits(input.unit);
      return [
        { key: `${input.key}:mass`, label: "Mass", unit: displayUnit(units?.mass), inputKey: input.key, part: "mass" },
        { key: `${input.key}:distance`, label: "Distance", unit: displayUnit(units?.distance), inputKey: input.key, part: "distance" },
      ];
    }
    const label = gas && input.quantityKind === "mass" ? "Total mass flow of gas" : (INPUT_LABELS[input.quantityKind] ?? "Value");
    return [{ key: input.key, label, unit: displayUnit(input.unit), inputKey: input.key, part: "value" }];
  });
}

/** Draft field values from an existing entry (edit, enter again). */
export function draftFromEntry(entry: EmissionEntry): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const value of entry.values) {
    if (value.massDistanceDetail) {
      draft[`${value.inputKey}:mass`] = value.massDistanceDetail.mass.magnitude;
      draft[`${value.inputKey}:distance`] = value.massDistanceDetail.distance.magnitude;
    } else draft[value.inputKey] = value.magnitude;
  }
  return draft;
}

export function validateFields(line: EmissionLine, draft: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of entryFields(line)) if (!isDecimal(draft[field.key] ?? "")) errors[field.key] = DECIMAL_MESSAGE;
  return errors;
}

/** The figure a mass-distance draft computes ("55.2 t·km"), or null until both parts are numbers. */
export function draftMassDistanceFigure(line: EmissionLine, draft: Record<string, string>): string | null {
  const input = line.inputShape.find((candidate) => candidate.quantityKind === "mass_distance");
  if (!input) return null;
  const mass = draft[`${input.key}:mass`] ?? "";
  const distance = draft[`${input.key}:distance`] ?? "";
  if (!isDecimal(mass) || !isDecimal(distance)) return null;
  return formatFigure({ magnitude: multiplyDecimals(mass.trim(), distance.trim()), unit: input.unit ?? "" });
}

/** Wire values for create and update. Call after validateFields passes. */
export function entryValues(line: EmissionLine, draft: Record<string, string>) {
  return line.inputShape.map((input) => {
    const unit = input.unit ?? "";
    if (input.quantityKind === "mass_distance") {
      const units = massDistanceUnits(unit)!;
      const mass = draft[`${input.key}:mass`].trim();
      const distance = draft[`${input.key}:distance`].trim();
      return {
        inputKey: input.key,
        quantityKind: input.quantityKind,
        magnitude: multiplyDecimals(mass, distance),
        unit: canonicalUnit("mass_distance", `${units.mass} * ${units.distance}`) ?? unit,
        massDistanceDetail: { mass: { magnitude: mass, unit: units.mass }, distance: { magnitude: distance, unit: units.distance } },
      };
    }
    return { inputKey: input.key, quantityKind: input.quantityKind, magnitude: draft[input.key].trim(), unit, massDistanceDetail: null };
  });
}

/* ---------- dates ---------- */

/** Today clamped into the batch period. */
export function defaultEntryDate(today: string, batch: { startDate: string; endDate: string | null }): string {
  if (today < batch.startDate) return batch.startDate;
  if (batch.endDate && today > batch.endDate) return batch.endDate;
  return today;
}

export function validateEntryDate(date: string, today: string, startDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return DATE_INVALID_MESSAGE;
  if (date < startDate) return DATE_BEFORE_START_MESSAGE;
  if (date > today) return DATE_IN_FUTURE_MESSAGE;
  return null;
}

/* ---------- files ---------- */

export const ENTRY_FILE_ACCEPT = "image/*,application/pdf,.pdf";
const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|heic|heif)$/i;

/** Document type for an entry file: photos stay photos, everything else is filed as a PDF document. */
export function entryDocumentType(file: { name: string; type: string }): "photo" | "pdf" {
  return file.type.toLowerCase().startsWith("image/") || IMAGE_EXTENSION.test(file.name) ? "photo" : "pdf";
}
