import { describe, expect, it } from "vitest";
import {
  addEntryRefusal,
  defaultEntryDate,
  displayUnit,
  draftFromEntry,
  draftMassDistanceFigure,
  entryFields,
  entryValues,
  groupLines,
  lineMatches,
  lineCounts,
  lineTotalText,
  kgToTonnes,
  multiplyDecimals,
  tonnesToKg,
  recordsChipText,
  countedOnHref,
  isRecordsGap,
  recordsHref,
  recordsText,
  recordsFigureText,
} from "./emission-line-display";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { deriveBatchEmissionLines, withoutRegistryCalculatedLines } from "@/lib/certification/emission-lines";
import { validateEntryDate } from "@/schemas/emission-entry-form";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";
import type { EmissionLine } from "./emission-line-display";

const RUNS = { source: "productionRuns" as const, count: 22, figure: { magnitude: "120", unit: "L" } };

function sequestrationLine(applicationCount: number) {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  const line = deriveBatchEmissionLines({
    definition, lineSources: resolveLineSources({ definition }), problems: [], enrichmentComplete: true,
    automaticFigures: { sequestration: null }, automaticRecordCounts: { sequestration: applicationCount }, entries: [],
  }).find((line) => line.contract?.automaticSource === "sequestration")!;
  return makeLine({ ...line, entries: [] });
}

describe("Isometric sequestration display", () => {
  it.each([1, 15])("drops handled sequestration with %s applications from counts and filters", (count) => {
    const sequestration = sequestrationLine(count);
    const other = makeLine({ componentId: "other", state: "empty" });
    const shown = withoutRegistryCalculatedLines([sequestration, other]);
    expect(shown).toEqual([other]);
    expect(lineCounts(shown)).toEqual({ all: 1, open: 1, missing: 0, review: 0, notRecorded: 1, done: 0 });
    expect(groupLines(shown).map((group) => group.key)).not.toContain(sequestration.groupKey);
  });

  it("keeps a batch without applications open and makes counts agree with filters", () => {
    const empty = sequestrationLine(0);
    expect(lineTotalText(empty)).toBe("Not recorded");
    expect(recordsChipText(empty.records!)).toBe("No applications yet");
    expect(recordsFigureText(empty.records!)).toBe("Not recorded");
    expect(isRecordsGap(empty.records)).toBe(true);
    const shown = withoutRegistryCalculatedLines([empty, sequestrationLine(15)]);
    expect(shown).toEqual([empty]);
    expect(lineCounts(shown)).toEqual({ all: 1, open: 1, missing: 0, review: 0, notRecorded: 1, done: 0 });
    expect(shown.filter((line) => lineMatches(line, "open"))).toEqual([empty]);
    expect(shown.filter((line) => lineMatches(line, "done"))).toEqual([]);
    expect(groupLines(shown).map((group) => group.key)).toContain(empty.groupKey);
  });
});

describe("records copy", () => {
  it("names the figure, the gap and the empty source", () => {
    expect(recordsChipText(RUNS)).toBe("22 runs");
    expect(recordsText(RUNS)).toBe("120 L from 22 production runs");
    expect(recordsFigureText(RUNS)).toBe("120 L");
    expect(recordsChipText({ ...RUNS, figure: null })).toBe("None on 22 runs");
    expect(recordsText({ ...RUNS, figure: null })).toBe("Not recorded on 22 production runs");
    expect(recordsFigureText({ ...RUNS, figure: null })).toBe("Not recorded");
    expect(recordsChipText({ source: "deliveries", count: 0, figure: null })).toBe("No deliveries yet");
    expect(recordsChipText({ source: "transportLegs", count: 1, figure: { magnitude: "5", unit: "km * tonne" } })).toBe("1 leg");
  });

  it("names the batches that count the legs instead of a bare zero", () => {
    const zero = { magnitude: "0", unit: "km * tonne" };
    const counted = { source: "transportLegs" as const, count: 0, figure: zero, countedOn: [{ creditBatchId: "a", code: "CB-26-001" }, { creditBatchId: "b", code: "CB-26-002" }] };
    expect(recordsChipText(counted)).toBe("Counted on CB-26-001, CB-26-002");
    expect(recordsText(counted)).toBe("Counted on CB-26-001, CB-26-002");
    expect(isRecordsGap(counted)).toBe(false);
    expect(recordsFigureText(counted)).toBe("0 t·km");
    expect(countedOnHref("a", "fac")).toBe("/credit-batches/a?facility=fac&tab=emissions");
    expect(recordsChipText({ ...counted, countedOn: undefined })).toBe("No transport legs yet");
  });

  it("links runs, deliveries and applications filtered to the credit batch", () => {
    const ids = { facilityId: "fac", creditBatchId: "cb" };
    expect(recordsHref(RUNS, ids)).toBe("/production-runs?facility=fac&creditBatch=cb");
    expect(recordsHref({ source: "transportLegs", count: 2, figure: null }, ids)).toBe("/feedstock-intake?facility=fac");
  });
});

describe("units and totals", () => {
  it("reads canonical units the way operators write them", () => {
    expect(displayUnit("km * tonne")).toBe("t·km");
    expect(displayUnit("mg / kg")).toBe("mg/kg");
    expect(displayUnit("tonne")).toBe("t");
    expect(displayUnit("kWh")).toBe("kWh");
  });

  it("shows Not recorded, a confirmed zero and Not set up", () => {
    expect(lineTotalText(makeLine())).toBe("Not recorded");
    expect(lineTotalText(makeLine({ state: "confirmedZero", unit: "km" }))).toBe("0 km");
    expect(lineTotalText(makeLine({ state: "needsSetup" }))).toBe("Not set up");
    expect(lineTotalText(makeLine({ state: "filled", total: { magnitude: "19880", unit: "kWh" } }))).toBe("19,880 kWh");
  });

  it("leaves the Total out, never Not recorded, when a line holds figures that do not add up", () => {
    const mixedUnits = makeLine({ state: "needsReview", entries: [makeEntry({ values: [{ id: "v1", organizationId: "org", entryId: "entry-1", inputKey: "energy", magnitude: "3.2", unit: "MWh", massDistanceDetail: null }], total: null })] });
    expect(lineTotalText(mixedUnits)).toBeNull();
    expect(lineTotalText(makeLine({ state: "needsReview", entries: [makeEntry({ counts: false })] }))).toBeNull();
    const records = { source: "productionRuns" as const, count: 3, figure: { magnitude: "72", unit: "kWh" } };
    expect(lineTotalText(makeLine({ state: "needsReview", records } as never))).toBeNull();
    expect(lineTotalText(makeLine({ records: { ...records, figure: null } } as never))).toBe("Not recorded");
  });

  it("multiplies decimals exactly", () => {
    expect(multiplyDecimals("0.012", "4600")).toBe("55.2");
    expect(multiplyDecimals("1.5", "2.25")).toBe("3.375");
  });
});

describe("mass in kg on mass × distance lines", () => {
  const line = makeLine({
    unit: "kg * km",
    inputShape: [{ key: "leg", type: "monitored", quantityKind: "mass_distance", unit: "km * tonne" }],
  } as never);

  it("converts kg and tonnes exactly", () => {
    expect(kgToTonnes("12")).toBe("0.012");
    expect(kgToTonnes("1500.25")).toBe("1.50025");
    expect(kgToTonnes("0.1")).toBe("0.0001");
    expect(tonnesToKg("0.012")).toBe("12");
    expect(tonnesToKg("1.50025")).toBe("1500.25");
  });

  it("labels the mass field kg, shows the live t·km and sends tonnes", () => {
    expect(entryFields(line)[0]).toMatchObject({ part: "mass", unit: "kg" });
    const draft = { "leg:mass": "12", "leg:distance": "4600" };
    expect(draftMassDistanceFigure(line, draft)).toBe("55.2 t·km");
    const [value] = entryValues(line, draft);
    expect(value.magnitude).toBe("55.2");
    expect(value.massDistanceDetail?.mass).toEqual({ magnitude: "0.012", unit: "tonne" });
  });

  it("shows a stored mass back in kg when editing", () => {
    const entry = makeEntry({
      values: [{ inputKey: "leg", magnitude: "55.2", unit: "tonne * km", massDistanceDetail: { mass: { magnitude: "0.012", unit: "tonne" }, distance: { magnitude: "4600", unit: "km" } } }],
    } as never);
    expect(draftFromEntry(entry, line)).toEqual({ "leg:mass": "12", "leg:distance": "4600" });
  });

  it("leaves mass and distance empty when the line's units changed", () => {
    const entry = makeEntry({
      values: [{ inputKey: "leg", magnitude: "55.2", unit: "tonne * km", massDistanceDetail: { mass: { magnitude: "0.012", unit: "tonne" }, distance: { magnitude: "4600", unit: "km" } } }],
    } as never);
    const miles = { ...line, inputShape: [{ ...line.inputShape[0], unit: "mi * tonne" }] };
    expect(draftFromEntry(entry, miles)).toEqual({});
  });
});

describe("enter again", () => {
  it("keeps values whose unit still matches and clears the ones the template changed", () => {
    const entry = makeEntry({ counts: false });
    expect(draftFromEntry(entry, makeLine())).toEqual({ energy: "42.5" });
    const wattHours = makeLine({ inputShape: [{ key: "energy", type: "monitored", quantityKind: "energy", unit: "Wh" }] } as never);
    expect(draftFromEntry(entry, wattHours)).toEqual({});
  });
});

describe("add manual entry", () => {
  it("takes one entry per credit batch on single lines", () => {
    const single = makeLine({ entryPolicy: "single" });
    expect(addEntryRefusal(single)).toBeNull();
    expect(addEntryRefusal({ ...single, entries: [makeEntry()] })).toBe("One manual entry per credit batch");
    expect(addEntryRefusal(makeLine({ entryPolicy: "none" }))).toBe("This component takes no manual entries");
  });

  it("splits a mass-distance input into mass and distance and sends the exact product", () => {
    const line = makeLine({ unit: "km * tonne", inputShape: [{ key: "md", type: "monitored", quantityKind: "mass_distance", unit: "km * tonne" }] });
    expect(entryFields(line).map((field) => `${field.label} ${field.unit}`)).toEqual(["Mass kg", "Distance km"]);
    expect(entryValues(line, { "md:mass": "12", "md:distance": "4600" })).toEqual([
      {
        inputKey: "md",
        quantityKind: "mass_distance",
        magnitude: "55.2",
        unit: "km * tonne",
        massDistanceDetail: { mass: { magnitude: "0.012", unit: "tonne" }, distance: { magnitude: "4600", unit: "km" } },
      },
    ]);
  });

  it("labels the paired gas inputs", () => {
    const gas = makeLine({
      entryPolicy: "single",
      inputShape: [
        { key: "c", type: "monitored", quantityKind: "mass_fraction", unit: "mg / kg" },
        { key: "m", type: "monitored", quantityKind: "mass", unit: "kg" },
      ],
    });
    expect(entryFields(gas).map((field) => field.label)).toEqual(["Concentration in emitted gas", "Total mass flow of gas"]);
  });
});

describe("dates", () => {
  const batch = { startDate: "2026-09-01", endDate: "2026-09-30" };
  it("defaults to today clamped into the batch period", () => {
    expect(defaultEntryDate("2026-10-16", batch)).toBe("2026-09-30");
    expect(defaultEntryDate("2026-09-12", batch)).toBe("2026-09-12");
    expect(defaultEntryDate("2026-08-01", batch)).toBe("2026-09-01");
  });
  it("refuses dates before the batch and in the future", () => {
    expect(validateEntryDate("2026-08-31", "2026-10-16", batch.startDate)).toMatch(/before the credit batch start/);
    expect(validateEntryDate("2026-10-17", "2026-10-16", batch.startDate)).toMatch(/future/);
    expect(validateEntryDate("2026-09-10", "2026-10-16", batch.startDate)).toBeNull();
  });
});

describe("filters and groups", () => {
  it("matches the state chips", () => {
    expect(lineMatches(makeLine({ state: "missingEvidence" }), "open")).toBe(true);
    expect(lineMatches(makeLine({ state: "confirmedZero" }), "done")).toBe(true);
    expect(lineMatches(makeLine({ state: "empty" }), "notRecorded")).toBe(true);
    expect(lineMatches(makeLine({ state: "filled" }), "open")).toBe(false);
  });
  it("groups template components in order under the server's group names", () => {
    const groups = groupLines([
      makeLine({ componentId: "a", groupKey: "co2-stored", groupName: "CO₂ stored" }),
      makeLine({ componentId: "b", groupKey: "co2-stored", groupName: "CO₂ stored" }),
      makeLine({ componentId: "c", groupKey: "sampling-required-for-mrv", groupName: "Sampling required for MRV" }),
    ]);
    expect(groups.map((group) => `${group.label} ${group.lines.length}`)).toEqual(["CO₂ stored 2", "Sampling required for MRV 1"]);
  });
  it("puts a line removed from the template at the end of its group, not in a second group", () => {
    const groups = groupLines([
      makeLine({ componentId: "a", groupKey: "pyrolysis", groupName: "Pyrolysis" }),
      makeLine({ componentId: "b", groupKey: "transport", groupName: "Transport" }),
      makeLine({ componentId: "removed", groupKey: "pyrolysis", groupName: "Pyrolysis" }),
    ]);
    expect(groups.map((group) => [group.key, group.lines.map((line) => line.componentId)])).toEqual([
      ["pyrolysis", ["a", "removed"]],
      ["transport", ["b"]],
    ]);
  });
});

describe("time-based lines", () => {
  const timeLine = (ratePerHour: number | null, overrides: Partial<EmissionLine> = {}) =>
    makeLine({
      state: "filled",
      blueprintKey: "time_based_emissions",
      timeEmission: { ratePerHour },
      unit: "h",
      total: { magnitude: "12.5", unit: "h" },
      inputShape: [{ key: "time", type: "monitored", quantityKind: "time", unit: "h" }],
      ...overrides,
    } as never);

  it("labels the field Operating hours, and other lines keep Value", () => {
    expect(entryFields(timeLine(0.41264)).map((field) => field.label)).toEqual(["Operating hours"]);
    expect(entryFields(timeLine(null)).map((field) => field.label)).toEqual(["Operating hours"]);
    const other = makeLine({ inputShape: [{ key: "x", type: "monitored", quantityKind: "dimensionless", unit: "1" }] } as never);
    expect(entryFields(other).map((field) => field.label)).toEqual(["Value"]);
    const plainTime = makeLine({ inputShape: [{ key: "t", type: "monitored", quantityKind: "time", unit: "h" }] } as never);
    expect(entryFields(plainTime).map((field) => field.label)).toEqual(["Value"]);
  });

  it("shows the hours with their CO₂e", () => {
    expect(lineTotalText(timeLine(0.41264))).toBe("12.5 h · 5.2 kg CO₂e");
    const at = (hours: string, rate = 0.41264) => lineTotalText(timeLine(rate, { total: { magnitude: hours, unit: "h" } } as never));
    expect(at("1")).toBe("1 h · 0.4 kg CO₂e");
    expect(at("0.1")).toBe("0.1 h · <0.1 kg CO₂e");
    expect(at("0")).toBe("0 h · 0 kg CO₂e");
    expect(at("5000")).toBe("5,000 h · 2.063 t CO₂e");
  });

  it("shows the hours alone when the rate is unknown", () => {
    expect(lineTotalText(timeLine(null))).toBe("12.5 h");
  });
});
