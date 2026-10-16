/**
 * PROTOTYPE shared vocabulary for the C3a, C3b and C3c variants (round 3
 * brief, c3-round3-brief.md §1 to §4). Pure helpers: every variant reads the
 * composition of a line, its row menu and its add form notes from here so the
 * copy is identical. A line's figure is an equation: From records + Entries =
 * Total.
 */
import { formatFigure, formatNumber, entryText, type PrototypeLine, type RecordsLabel } from "./prototype-emissions-data";

export type LineCase = "A" | "B1" | "B2" | "C" | "D" | "E" | "F" | "S" | "Z" | "R";

export type RecordsSource =
  | { kind: "none" }
  | { kind: "records"; value: number | null; count: number; label: RecordsLabel; href: string };

export interface RowMenuItem {
  key: "add" | "addFile" | "confirm" | "open" | "nothing" | "description";
  label: string;
  disabled?: boolean;
  /** Shown as the item description when disabled. */
  reason?: string;
  /** Upstream page for the "open" item. */
  href?: string;
}

const NO_RECORDS_SOURCE = "No records source";
const ONE_PER_BATCH = "One entry per credit batch";
const TAKES_NO_ENTRIES = "Takes no entries";

/** The prototype links unfiltered pages. The real links filter to the batch window. */
const RECORDS_HREFS: Record<RecordsLabel, string> = {
  "production runs": "/production-runs",
  "transport legs": "/feedstocks",
  deliveries: "/deliveries",
  applications: "/applications",
};
const OPEN_LABELS: Record<RecordsLabel, string> = {
  "production runs": "Open production runs",
  "transport legs": "Open transport legs",
  deliveries: "Open deliveries",
  applications: "Open applications",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`.trim();
}
function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count, 0)} ${count === 1 ? one : many}`;
}
function countLabel(count: number, label: RecordsLabel): string {
  const one = { "production runs": "production run", "transport legs": "transport leg", deliveries: "delivery", applications: "application" }[label];
  return plural(count, one, label);
}
function hasRecordsFigure(line: PrototypeLine): boolean {
  return line.auto != null && line.auto.value > 0;
}
function entriesTotal(line: PrototypeLine): number {
  return line.values.reduce((sum, entry) => sum + (line.def.shape === "massDistance" && entry.mass != null && entry.distance != null ? (entry.mass * entry.distance) / 1000 : entry.value ?? 0), 0);
}

export function lineCase(line: PrototypeLine): LineCase {
  if (line.def.rule === "single") return "S";
  if (line.def.rule === "none") return "R";
  const hasEntries = line.values.length > 0;
  if (!line.records) {
    if (hasEntries) return "C";
    return line.nothing ? "Z" : "A";
  }
  if (hasRecordsFigure(line)) return hasEntries ? "E" : "D";
  if (hasEntries) return "F";
  if (line.nothing) return "Z";
  return line.records.count > 0 ? "B1" : "B2";
}

export function recordsSource(line: PrototypeLine): RecordsSource {
  if (!line.records) return { kind: "none" };
  const { value, count, label } = line.records;
  return { kind: "records", value, count, label, href: RECORDS_HREFS[label] };
}

/** The From records cell. */
export function recordsText(line: PrototypeLine): string {
  if (line.def.rule === "single") return ONE_PER_BATCH;
  const source = recordsSource(line);
  if (source.kind === "none") return NO_RECORDS_SOURCE;
  if (source.value != null) return `${formatFigure(source.value, line.def.unit)} from ${countLabel(source.count, source.label)}`;
  if (source.count > 0) return `Not recorded on ${countLabel(source.count, source.label)}`;
  return `No ${source.label} yet`;
}

/** The Entries cell. */
export function entriesText(line: PrototypeLine): string {
  if (line.def.rule === "none") return TAKES_NO_ENTRIES;
  if (line.nothing && !line.values.length) return `Nothing to record, ${shortDate(line.nothing.date)}`;
  if (!line.values.length) return line.review.length ? "Stopped counting" : "None";
  if (line.def.shape === "gas") return entryText(line.def, line.values[0]);
  return `${formatFigure(entriesTotal(line), line.def.unit)}, ${plural(line.values.length, "entry", "entries")}`;
}

/** "18,420 kWh from 22 production runs + 1,460 kWh from 2 entries"; empty when there is nothing to compose. */
export function compositionCaption(line: PrototypeLine): string {
  const kind = lineCase(line);
  if (kind === "S") return line.values.length ? entriesText(line) : ONE_PER_BATCH;
  if (kind === "Z") return entriesText(line);
  if (kind === "A") return NO_RECORDS_SOURCE;
  const records = recordsSource(line).kind === "none" ? null : recordsText(line);
  const entries = line.values.length ? `${formatFigure(entriesTotal(line), line.def.unit)} from ${plural(line.values.length, "entry", "entries")}` : null;
  return [records, entries].filter(Boolean).join(" + ");
}

const WARNING_BY_LABEL: Record<RecordsLabel, (line: PrototypeLine) => string> = {
  "production runs": (line) => {
    const noun = line.def.activity === "diesel" ? "Fuel" : line.def.activity === "electricity" ? "Electricity" : "Anything used";
    const what = line.def.activity === "diesel" ? "diesel" : line.def.activity === "electricity" ? "electricity" : "what";
    return `${noun} used in a run belongs on that run. Add an entry only for ${what} no run covers.`;
  },
  "transport legs": () => "A pickup belongs on a transport leg. Add an entry only for transport no leg covers.",
  deliveries: () => "A delivery belongs on its own record. Add an entry only for transport no delivery covers.",
  applications: () => TAKES_NO_ENTRIES,
};

/** The note under the From records block of the add form. B and F get the warning; D and E the "on top" line; A and C nothing. */
export function entryGuard(line: PrototypeLine): string | null {
  const kind = lineCase(line);
  if (kind === "D" || kind === "E") return `Adds on top of ${recordsText(line)}.`;
  if ((kind === "B1" || kind === "B2" || kind === "F" || kind === "Z") && line.records) return WARNING_BY_LABEL[line.records.label](line);
  return null;
}

/** null when Nothing to record is allowed, else the reason it is refused. */
export function nothingToRecordRefusal(line: PrototypeLine): string | null {
  if (line.values.length) return `Has ${plural(line.values.length, "entry", "entries")}`;
  if (line.auto && line.auto.value > 0) return `Has ${formatFigure(line.auto.value, line.def.unit)} from ${line.auto.label}`;
  return null;
}

/** Ordered row menu (brief §2). Edit and Delete entry live with the entry, never here. */
export function rowMenuItems(line: PrototypeLine): RowMenuItem[] {
  const description: RowMenuItem = { key: "description", label: "Line description" };
  if (line.state === "needsSetup") return [description];
  const kind = lineCase(line);
  const items: RowMenuItem[] = [];
  const source = recordsSource(line);
  const open: RowMenuItem | null = source.kind === "records" ? { key: "open", label: OPEN_LABELS[source.label], href: source.href } : null;
  const add: RowMenuItem | null =
    kind === "R" ? null
      : kind === "S" && line.values.length ? { key: "add", label: "Add entry", disabled: true, reason: "One entry per credit batch" }
        : { key: "add", label: "Add entry" };
  // On B the upstream page comes first: diesel belongs on the run, a pickup on a leg.
  const upstreamFirst = kind === "B1" || kind === "B2";
  if (upstreamFirst && open) items.push(open);
  if (add) items.push(add);
  if (line.state === "missingEvidence") items.push({ key: "addFile", label: "Add file" });
  if (line.state === "needsReview") items.push({ key: "confirm", label: "Confirm" });
  if (!upstreamFirst && open) items.push(open);
  if (kind !== "Z" && kind !== "R") {
    const refusal = nothingToRecordRefusal(line);
    items.push({ key: "nothing", label: "Nothing to record", ...(refusal ? { disabled: true, reason: refusal } : {}) });
  }
  items.push(description);
  return items;
}

/** Two blocks and an arrow: the total before and after saving a draft entry figure (in the line unit). */
export function totalAfter(line: PrototypeLine, draftValue: number | null): { before: string; after: string } {
  const before = line.def.shape === "gas" ? line.totalText : line.total != null ? formatFigure(line.total, line.def.unit) : line.state === "nothingToRecord" ? line.totalText : "Not recorded";
  if (draftValue == null || Number.isNaN(draftValue)) return { before, after: before };
  // A zero entry is replaced, not added to.
  const base = line.state === "nothingToRecord" ? 0 : line.total ?? 0;
  return { before, after: formatFigure(base + draftValue, line.def.unit) };
}
