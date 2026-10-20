/**
 * PROTOTYPE ONLY (epic #1058 PR 4, empty-line confirmation). Never merged.
 * Fixture credit batches with the Dark Earth Carbon sandbox template lines
 * (15 Oct), built with the real EmissionLine shape so the prototype reuses the
 * real line vocabulary (lineTotalText, EMISSION_LINE_STATE_LABELS).
 */
import { makeEntry, makeLine } from "@/components/emissions/emission-line-test-fixtures";
import type { EmissionLine } from "@/components/emissions/emission-line-display";

export type ProtoVariant = "a" | "b" | "c";
export type ProtoScenario = "one" | "two";

export interface ProtoBatch {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  dryTons: number;
  durability: string;
  /** Ready to group, or the unmet checks (#1200 words: "Template set", "Lines decided"). */
  issues: string[];
  lines: EmissionLine[];
  /** File names per line, for the "Lines sent" Files column. */
  files: Record<string, string[]>;
}

/** Who confirms, and when (facility today). */
export const PROTO_ACTOR = "Amani Mushi";
export const PROTO_CONFIRMED_AT = "20 Oct 2026, 14:05";

let seq = 0;
function line(
  groupKey: string,
  groupName: string,
  displayName: string,
  over: Partial<EmissionLine>,
): EmissionLine {
  seq += 1;
  return makeLine({
    componentId: `${groupKey}-${seq}`,
    displayName,
    label: displayName,
    groupKey,
    groupName,
    ...over,
  });
}

function filledAuto(magnitude: string, unit: string, source: "productionRuns" | "transportLegs" | "deliveries" | "applications", count: number): Partial<EmissionLine> {
  return {
    state: "filled",
    unit,
    records: { source, count, figure: { magnitude, unit } },
    automaticFigure: { magnitude, unit },
    total: { magnitude, unit },
    entries: [],
  } as Partial<EmissionLine>;
}

function filledManual(magnitude: string, unit: string, entries = 1): Partial<EmissionLine> {
  return {
    state: "filled",
    unit,
    records: null,
    total: { magnitude, unit },
    entries: Array.from({ length: entries }, (_, i) =>
      makeEntry({ id: `e-${seq}-${i}`, values: [{ id: "v", organizationId: "o", entryId: "e", inputKey: "v", magnitude, unit, massDistanceDetail: null }], total: { magnitude, unit } }),
    ),
  } as Partial<EmissionLine>;
}

function empty(unit: string, records: EmissionLine["records"] = null): Partial<EmissionLine> {
  return { state: "empty", unit, records, total: null, entries: [] } as Partial<EmissionLine>;
}

/** One batch's template lines. `emptyKeys` picks which lines have nothing this batch. */
function templateLines(emptyNames: ReadonlySet<string>): { lines: EmissionLine[]; files: Record<string, string[]> } {
  const files: Record<string, string[]> = {};
  const add = (l: EmissionLine, f: string[] = []) => {
    files[l.componentId] = f;
    return l;
  };
  const pick = (name: string, filled: Partial<EmissionLine>, emptyOver: Partial<EmissionLine>) =>
    emptyNames.has(name) ? emptyOver : filled;
  const lines = [
    add(line("feedstock-transport", "Biomass feedstock transport", "Biomass transportations to processing site via truck", filledAuto("18420", "km * tonne", "transportLegs", 14)), ["weighbridge-tickets-sep.pdf", "route-log-sep.pdf"]),
    add(line("pyrolysis", "Pyrolysis", "Metered electricity use emissions", filledAuto("1240", "kWh", "productionRuns", 22)), ["meter-readings-sep.csv"]),
    add(line("pyrolysis", "Pyrolysis", "Generator diesel usage", {
      ...filledAuto("350", "L", "productionRuns", 22),
      records: { source: "productionRuns", count: 22, figure: { magnitude: "310", unit: "L" } },
      entries: [makeEntry({ id: "e-diesel", values: [{ id: "v", organizationId: "o", entryId: "e", inputKey: "v", magnitude: "40", unit: "L", massDistanceDetail: null }], total: { magnitude: "40", unit: "L" } })],
    } as Partial<EmissionLine>), ["fuel-receipt-2026-09-14.jpg"]),
    add(line("pyrolysis", "Pyrolysis", "Startup diesel usage",
      pick("Startup diesel usage", filledAuto("12", "L", "productionRuns", 22), empty("L", { source: "productionRuns", count: 22, figure: null }))),
      emptyNames.has("Startup diesel usage") ? [] : ["startup-log-aug.pdf"]),
    add(line("direct", "Direct emissions", "Pyrolyzer CH₄ emissions", filledManual("0.8", "kg")), ["gas-analysis-ch4-sep.pdf"]),
    add(line("direct", "Direct emissions", "Pyrolyzer CO emissions", filledManual("2.1", "kg")), ["gas-analysis-co-sep.pdf"]),
    add(line("biochar-transport", "Biochar transport", "Biochar transportation to storage site via truck", filledAuto("2310", "km * tonne", "deliveries", 6)), ["delivery-notes-sep.pdf"]),
    add(line("sampling", "Sampling required for MRV", "Mass-distance-based CI emissions samples to EU", filledManual("84", "km * tonne")), ["dhl-awb-4471.pdf"]),
    add(line("sampling", "Sampling required for MRV", "Sampling consumables", filledManual("2.4", "kg")), ["consumables-invoice.pdf"]),
    add(line("sampling", "Sampling required for MRV", "Laboratory analysis electricity use EU", filledManual("18", "kWh")), ["lab-statement-eu.pdf"]),
    add(line("sampling", "Sampling required for MRV", "Laboratory analysis electricity use India",
      pick("Laboratory analysis electricity use India", filledManual("9", "kWh"), empty("kWh"))),
      emptyNames.has("Laboratory analysis electricity use India") ? [] : ["lab-statement-in.pdf"]),
    add(line("sampling", "Sampling required for MRV", "Mass-distance-based CI emissions samples to India",
      pick("Mass-distance-based CI emissions samples to India", filledManual("21", "km * tonne"), empty("km * tonne"))),
      emptyNames.has("Mass-distance-based CI emissions samples to India") ? [] : ["courier-in-0812.pdf"]),
    add(line("travel", "Staff travel", "Staff travel flights",
      pick("Staff travel flights", filledManual("6400", "km"), empty("km"))),
      emptyNames.has("Staff travel flights") ? [] : ["flight-ZRH-DAR.pdf"]),
    add(line("travel", "Staff travel", "Staff travel local",
      pick("Staff travel local", filledManual("320", "km"), empty("km"))),
      emptyNames.has("Staff travel local") ? [] : ["mileage-aug.xlsx"]),
  ];
  return { lines, files };
}

const SEP_EMPTY = new Set([
  "Startup diesel usage",
  "Laboratory analysis electricity use India",
  "Mass-distance-based CI emissions samples to India",
  "Staff travel flights",
  "Staff travel local",
]);

function batch(id: string, code: string, startDate: string, endDate: string, dryTons: number, durability: string, emptyNames: ReadonlySet<string>, issues: string[] = []): ProtoBatch {
  const { lines, files } = templateLines(emptyNames);
  return { id, code, startDate, endDate, dryTons, durability, issues, lines, files };
}

/** Selectable batches per scenario. The two-batch scenario is a 200-year facility. */
export function protoBatches(scenario: ProtoScenario): ProtoBatch[] {
  seq = 0;
  const durability = scenario === "two" ? "200 years" : "1000 years";
  return [
    batch("cb-sep", "CB-26-009", "2026-09-01", "2026-09-30", 12.4, durability, SEP_EMPTY),
    batch("cb-aug", "CB-26-008", "2026-08-01", "2026-08-31", 9.8, durability, new Set()),
    batch("cb-oct", "CB-26-010", "2026-10-01", "2026-10-31", 4.1, durability, new Set(), ["Lines decided", "Carbon content", "Proof of delivery"]),
    batch("cb-jul", "CB-26-007", "2026-07-01", "2026-07-31", 7.2, durability, new Set(), ["Template set"]),
  ];
}

/** Batches selected when the prototype opens at a later step. */
export function protoSelection(scenario: ProtoScenario): string[] {
  return scenario === "two" ? ["cb-sep", "cb-aug"] : ["cb-sep"];
}

export function emptyLines(b: ProtoBatch): EmissionLine[] {
  return b.lines.filter((l) => l.state === "empty");
}
