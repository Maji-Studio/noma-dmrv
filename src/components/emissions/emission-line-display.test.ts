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
  lineTotalText,
  kgToTonnes,
  multiplyDecimals,
  tonnesToKg,
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

  it("shows Not recorded, a confirmed zero and Needs setup", () => {
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
    expect(addEntryRefusal(makeLine({ entryPolicy: "none" }))).toBe("This line takes no manual entries");
  });

  it("splits a mass-distance input into mass and distance and sends the exact product", () => {
    const line = makeLine({ unit: "km * tonne", inputShape: [{ key: "md", type: "monitored", quantityKind: "mass_distance", unit: "km * tonne" }] });
    expect(entryFields(line).map((field) => `${field.label} ${field.unit}`)).toEqual(["Mass kg", "Distance km"]);
    expect(validateFields(line, { "md:mass": "12", "md:distance": "x" })).toEqual({ "md:distance": "Enter a non-negative decimal value." });
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
  it("groups template lines in order under the server's group names", () => {
    const groups = groupLines([
      makeLine({ componentId: "a", groupKey: "co2-stored", groupName: "CO₂ stored" }),
      makeLine({ componentId: "b", groupKey: "co2-stored", groupName: "CO₂ stored" }),
      makeLine({ componentId: "c", groupKey: "sampling-required-for-mrv", groupName: "Sampling required for MRV" }),
    ]);
    expect(groups.map((group) => `${group.label} ${group.lines.length}`)).toEqual(["CO₂ stored 2", "Sampling required for MRV 1"]);
  });
});
