import { describe, expect, it } from "vitest";
import {
  addEntryRefusal,
  defaultEntryDate,
  displayUnit,
  entryFields,
  entryValues,
  groupLines,
  lineMatches,
  lineTotalText,
  multiplyDecimals,
  nothingApplies,
  nothingRefusal,
  recordsChipText,
  recordsHref,
  recordsText,
  validateEntryDate,
  validateFields,
} from "./emission-line-display";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";

const RUNS = { source: "productionRuns" as const, count: 22, figure: { magnitude: "120", unit: "L" } };

describe("records copy", () => {
  it("names the figure, the gap and the empty source", () => {
    expect(recordsChipText(RUNS)).toBe("22 runs");
    expect(recordsText(RUNS)).toBe("120 L from 22 production runs");
    expect(recordsChipText({ ...RUNS, figure: null })).toBe("None on 22 runs");
    expect(recordsText({ ...RUNS, figure: null })).toBe("Not recorded on 22 production runs");
    expect(recordsChipText({ source: "deliveries", count: 0, figure: null })).toBe("No deliveries yet");
    expect(recordsChipText({ source: "transportLegs", count: 1, figure: { magnitude: "5", unit: "km * tonne" } })).toBe("1 leg");
  });

  it("links runs, deliveries and applications filtered to the credit batch", () => {
    const ids = { facilityId: "fac", creditBatchId: "cb" };
    expect(recordsHref(RUNS, ids)).toBe("/production-runs?facility=fac&creditBatch=cb");
    expect(recordsHref({ source: "transportLegs", count: 2, figure: null }, ids)).toBe("/feedstocks?facility=fac");
  });
});

describe("units and totals", () => {
  it("reads canonical units the way operators write them", () => {
    expect(displayUnit("km * tonne")).toBe("t·km");
    expect(displayUnit("mg / kg")).toBe("mg/kg");
    expect(displayUnit("tonne")).toBe("t");
    expect(displayUnit("kWh")).toBe("kWh");
  });

  it("shows Not recorded, a zero for Nothing to record and Needs setup", () => {
    expect(lineTotalText(makeLine())).toBe("Not recorded");
    expect(lineTotalText(makeLine({ state: "confirmedZero", unit: "km" }))).toBe("0 km");
    expect(lineTotalText(makeLine({ state: "needsSetup" }))).toBe("Needs setup");
    expect(lineTotalText(makeLine({ state: "filled", total: { magnitude: "19880", unit: "kWh" } }))).toBe("19,880 kWh");
  });

  it("multiplies decimals exactly", () => {
    expect(multiplyDecimals("0.012", "4600")).toBe("55.2");
    expect(multiplyDecimals("1.5", "2.25")).toBe("3.375");
  });
});

describe("Nothing to record", () => {
  it("is refused with a reason when entries or records hold a figure", () => {
    expect(nothingRefusal(makeLine())).toBeNull();
    expect(nothingRefusal(makeLine({ entries: [makeEntry(), makeEntry({ id: "entry-2" })] }))).toBe("This line has 2 manual entries.");
    expect(nothingRefusal(makeLine({ records: RUNS }))).toBe("This line has 120 L from production runs.");
    expect(nothingRefusal(makeLine({ records: { ...RUNS, figure: null } }))).toBeNull();
  });

  it("does not apply to lines that take no entries, need setup or are already marked", () => {
    expect(nothingApplies(makeLine({ entryPolicy: "none" }))).toBe(false);
    expect(nothingApplies(makeLine({ state: "needsSetup" }))).toBe(false);
    expect(nothingApplies(makeLine({ entries: [makeEntry({ kind: "zero", values: [], total: null })] }))).toBe(false);
    expect(nothingApplies(makeLine())).toBe(true);
  });
});

describe("add manual entry", () => {
  it("takes one entry per credit batch on single lines", () => {
    const single = makeLine({ entryPolicy: "single" });
    expect(addEntryRefusal(single)).toBeNull();
    expect(addEntryRefusal({ ...single, entries: [makeEntry()] })).toBe("One manual entry per credit batch");
    expect(addEntryRefusal(makeLine({ entryPolicy: "none" }))).toBe("This line takes no manual entries");
  });

  it("splits a mass-distance input into mass and distance and sends the exact product", () => {
    const line = makeLine({ unit: "km * tonne", inputShape: [{ key: "md", type: "monitored", quantityKind: "mass_distance", unit: "km * tonne" }] });
    expect(entryFields(line).map((field) => `${field.label} ${field.unit}`)).toEqual(["Mass t", "Distance km"]);
    expect(validateFields(line, { "md:mass": "0.012", "md:distance": "x" })).toEqual({ "md:distance": "Enter a non-negative decimal value." });
    expect(entryValues(line, { "md:mass": "0.012", "md:distance": "4600" })).toEqual([
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
  it("groups template lines in order with readable names", () => {
    const groups = groupLines([
      makeLine({ componentId: "a", groupKey: "co2-stored" }),
      makeLine({ componentId: "b", groupKey: "co2-stored" }),
      makeLine({ componentId: "c", groupKey: "sampling-required-for-mrv" }),
    ]);
    expect(groups.map((group) => `${group.label} ${group.lines.length}`)).toEqual(["CO₂ stored 2", "Sampling required for MRV 1"]);
  });
});
