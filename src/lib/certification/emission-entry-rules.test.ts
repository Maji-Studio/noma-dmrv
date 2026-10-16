import { describe, expect, it } from "vitest";
import {
  normalizedEntryValues,
  resolveEmissionEntryDate,
  validateEntryDate,
  validateOperatorZero,
  emissionEntryCounts,
  validateEmissionEntry,
  multiplyEntryDecimals,
  type EntryObservation,
  type EntryValueInput,
} from "./emission-entry-rules";

export function observation(): EntryObservation {
  return {
    externalTemplateId: "template",
    definition: {
      groups: [
        {
          id: "group",
          key: "pyrolysis",
          displayName: "Group",
          description: "",
          components: [
            {
              id: "line",
              displayName: "Electricity",
              description: null,
              blueprintKey: "grid_electricity_use",
              inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
            },
          ],
        },
      ],
    },
    enrichment: { line: { electricity_use: { unit: "kWh" } } },
    lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
  };
}
const value: EntryValueInput = {
  inputKey: "electricity_use",
  quantityKind: "energy",
  magnitude: "0.100000000000000001",
  unit: "kWh",
};
it("does not require entry confirmation when display order is captured or changed", () => {
  const previous = observation();
  const current = observation();
  current.lineSources.line.templateOrder = { groupPosition: 8, position: 2 };
  expect(emissionEntryCounts(previous, current, "line")).toMatchObject({ counts: true });
  previous.lineSources.line.templateOrder = { groupPosition: 1, position: 0 };
  expect(emissionEntryCounts(previous, current, "line")).toMatchObject({ counts: true });
});
function args() {
  return {
    observation: observation(),
    componentId: "line",
    values: [value],
    occurredOn: "2026-10-15",
    batchStartDate: "2026-10-15",
    timezone: "America/Los_Angeles",
    now: new Date("2026-10-16T01:00:00Z"),
    activeValueCount: 0,
  };
}
describe("entry guards", () => {
  it("accepts the batch start date and additive siblings west of UTC", () => {
    expect(validateEmissionEntry({ ...args(), activeValueCount: 8 }).lineRule).toBe("additive");
  });
  it.each(["2026-10-14", "2026-10-16", "2026-02-30"])(
    "refuses out-of-window or invalid date %s",
    (occurredOn) => {
      expect(() => validateEmissionEntry({ ...args(), occurredOn })).toThrow();
    },
  );
  it("requires the pinned component", () => {
    expect(() => validateEmissionEntry({ ...args(), componentId: "missing" })).toThrow("no longer available");
  });
  it.each(["forbidden", "unassigned"] as const)("refuses %s scope", (scope) => {
    const input = args();
    input.observation.lineSources.line.scope = scope;
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
  });
  it("refuses none and unreviewed proposals", () => {
    const input = args();
    input.observation.lineSources.line.entryPolicy = "none";
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
    input.observation.lineSources.line.entryPolicy = "additive";
    input.observation.lineSources.line.origin = "proposed";
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
  });
  it.each(["-1", "NaN", "Infinity", "1e3", "", "1,2"])("refuses magnitude %s", (magnitude) => {
    expect(() => validateEmissionEntry({ ...args(), values: [{ ...value, magnitude }] })).toThrow("decimal");
  });
  it.each([
    { inputKey: "wrong" },
    { quantityKind: "mass" as const },
    { unit: "kg" },
    { unit: "kilowatt_hour" },
  ])("refuses mismatched input %j", (patch) => {
    expect(() => validateEmissionEntry({ ...args(), values: [{ ...value, ...patch }] })).toThrow();
  });
  it("refuses an unread input unit", () => {
    const input = args();
    input.observation.enrichment.line.electricity_use = { status: "unknown" };
    expect(() => validateEmissionEntry(input)).toThrow("Read the template input units");
  });
  it("requires all inputs exactly once", () => {
    expect(() => validateEmissionEntry({ ...args(), values: [] })).toThrow();
    expect(() => validateEmissionEntry({ ...args(), values: [value, value] })).toThrow();
  });
  it("accepts paired readings once, refuses a second single entry and automatic sources", () => {
    const input = args();
    const line = input.observation.definition.groups[0].components[0];
    line.inputs = ["initial_readout", "final_readout"].map((key) => ({
      key,
      type: "monitored",
      quantityKind: "energy",
    }));
    input.observation.lineSources.line.entryPolicy = "single";
    input.observation.enrichment.line = { initial_readout: { unit: "kWh" }, final_readout: { unit: "kWh" } };
    input.values = line.inputs.map((field) => ({ ...value, inputKey: field.key }));
    expect(validateEmissionEntry(input).lineRule).toBe("single");
    expect(() => validateEmissionEntry({ ...input, values: [input.values[0], input.values[0]] })).toThrow(
      "each input",
    );
    expect(() => validateEmissionEntry({ ...input, activeValueCount: 1 })).toThrow("already has");
    input.observation.lineSources.line.automaticSource = "run-electricity";
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
  });
  it("validates mass-distance detail by exact multiplication", () => {
    const input = args();
    const line = input.observation.definition.groups[0].components[0];
    line.blueprintKey = "mass_distance_based_ci_emissions";
    line.inputs = [{ key: "mass_distance", type: "monitored", quantityKind: "mass_distance" }];
    input.observation.enrichment.line = { mass_distance: { unit: "tonne * km" } };
    input.values = [
      {
        inputKey: "mass_distance",
        quantityKind: "mass_distance",
        magnitude: "0.02",
        unit: "km * tonne",
        massDistanceDetail: {
          mass: { magnitude: "0.1", unit: "tonne" },
          distance: { magnitude: "0.2", unit: "km" },
        },
      },
    ];
    expect(validateEmissionEntry(input).lineRule).toBe("additive");
    expect(() =>
      validateEmissionEntry({ ...input, values: [{ ...input.values[0], massDistanceDetail: null }] }),
    ).toThrow("Enter the mass and distance");
    input.values[0].magnitude = "0.03";
    expect(() => validateEmissionEntry(input)).toThrow("must match");
    expect(multiplyEntryDecimals("9007199254740993.1", "0.2")).toBe("1801439850948198.62");
  });
});
describe("entries after template changes", () => {
  it("counts unchanged and cosmetic lines", () => {
    const before = observation();
    const after = structuredClone(before);
    expect(emissionEntryCounts(before, after, "line").counts).toBe(true);
    after.definition.groups[0].components[0].displayName = "Power";
    expect(emissionEntryCounts(before, after, "line").counts).toBe(true);
  });
  it("requires re-entry for a changed unit", () => {
    const before = observation();
    const after = structuredClone(before);
    after.enrichment.line.electricity_use = { unit: "Wh" };
    expect(emissionEntryCounts(before, after, "line")).toMatchObject({ counts: false, canConfirm: false, reason: "Enter the values again for the current template line." });
    expect(emissionEntryCounts(after, after, "line").counts).toBe(true);
  });
  it.each(["removed", "kind", "policy", "scope", "template", "unknown-unit"])(
    "requires re-entry after %s",
    (change) => {
      const before = observation();
      const after = structuredClone(before);
      if (change === "removed") after.definition.groups[0].components = [];
      if (change === "kind") after.definition.groups[0].components[0].inputs[0].quantityKind = "mass";
      if (change === "policy") after.lineSources.line.entryPolicy = "none";
      if (change === "scope") after.lineSources.line.scope = "forbidden";
      if (change === "template") after.externalTemplateId = "different";
      if (change === "unknown-unit") after.enrichment.line.electricity_use = { status: "unknown" };
      expect(emissionEntryCounts(before, after, "line")).toMatchObject({ counts: false, canConfirm: false });
    },
  );
});

it("refuses a different supported scale instead of storing mixed units", () => {
  expect(() => validateEmissionEntry({ ...args(), values: [{ ...value, unit: "Wh" }] })).toThrow(
    "Choose a supported unit for this input.",
  );
});
it("normalizes decimal spelling, detail and input order for content comparison", () => {
  const first = { inputKey: "a", magnitude: "01.00", unit: "kg", massDistanceDetail: null };
  const second = {
    inputKey: "b",
    magnitude: "02.00",
    unit: "km * tonne",
    massDistanceDetail: {
      mass: { magnitude: "01.0", unit: "tonne" },
      distance: { magnitude: "02.0", unit: "km" },
    },
  };
  expect(normalizedEntryValues([second, first])).toEqual(
    normalizedEntryValues([
      { ...first, magnitude: "1" },
      {
        ...second,
        magnitude: "2",
        massDistanceDetail: {
          mass: { magnitude: "1", unit: "tonne" },
          distance: { magnitude: "2", unit: "km" },
        },
      },
    ]),
  );
  expect(normalizedEntryValues([first])).not.toEqual(normalizedEntryValues([{ ...first, magnitude: "2" }]));
});

it("still allows confirmation for a fixed-factor change with unchanged entry units", () => {
  const before = observation();
  before.definition.groups[0].components[0].inputs.push({
    key: "factor", type: "fixed", quantityKind: "energy",
  });
  before.enrichment.line.factor = { unit: "kWh", fixedValue: "1" };
  const after = structuredClone(before);
  after.enrichment.line.factor = { unit: "kWh", fixedValue: "2" };
  expect(emissionEntryCounts(before, after, "line")).toMatchObject({
    counts: false, canConfirm: true, reason: "Confirm this entry for the changed template line.",
  });
});

describe("operator-marked zeros", () => {
  const zero = () => ({ ...args(), activeOperatorZeroCount: 0, automaticFigure: null });
  it("trims an optional note without values or evidence", () => {
    expect(validateOperatorZero({ ...zero(), note: "  No lab work this batch.  " })).toMatchObject({ note: "No lab work this batch.", lineRule: "additive" });
  });
  it.each([undefined, null, "", " \n\t"])("accepts an absent or blank note %j as null", note => {
    expect(validateOperatorZero({ ...zero(), note })).toMatchObject({ note: null, lineRule: "additive" });
  });
  it("accepts marking a line with the note field omitted", () => {
    expect(validateOperatorZero(zero()).note).toBeNull();
  });
  it("refuses counting values and duplicate operator zeros", () => {
    expect(() => validateOperatorZero({ ...zero(), activeValueCount: 1 })).toThrow("This line has entries. Delete them before marking nothing to record.");
    expect(() => validateOperatorZero({ ...zero(), activeOperatorZeroCount: 1 })).toThrow("This line is already marked nothing to record. Edit its note instead.");
  });
  it("accepts absent or zero automatic figures and refuses positive run figures", () => {
    const input = zero();
    input.observation.lineSources.line.automaticSource = "run-electricity";
    expect(validateOperatorZero({ ...input, automaticFigure: { magnitude: "0" } }).lineRule).toBe("additive");
    expect(() => validateOperatorZero({ ...input, automaticFigure: { magnitude: "0.01" } })).toThrow("This line already has records from production runs. Nothing to record does not apply.");
  });
  it.each(["2026-10-14", "2026-10-16", "2026-02-30"])("enforces facility date bounds for %s", (occurredOn) => {
    expect(() => validateOperatorZero({ ...zero(), occurredOn })).toThrow();
  });
  it("allows single lines without entering their paired values", () => {
    const input = zero();
    input.observation.lineSources.line.entryPolicy = "single";
    input.observation.definition.groups[0].components[0].inputs = ["initial_readout", "final_readout"].map(key => ({ key, type: "monitored", quantityKind: "energy" }));
    expect(validateOperatorZero(input).lineRule).toBe("single");
  });
});

describe("entry date defaults", () => {
  const defaults = {
    entryPolicy: "additive" as const, batchStartDate: "2026-10-01", batchEndDate: null,
    timezone: "America/Los_Angeles", now: new Date("2026-10-16T01:00:00Z"),
  };
  it("uses facility today, caps ended batches and never defaults before the start", () => {
    expect(resolveEmissionEntryDate(defaults)).toBe("2026-10-15");
    expect(resolveEmissionEntryDate({ ...defaults, batchEndDate: "2026-10-10" })).toBe("2026-10-10");
    expect(resolveEmissionEntryDate({ ...defaults, batchStartDate: "2026-10-20" })).toBe("2026-10-20");
  });
  it("preserves explicit additive dates for existing validation", () => {
    expect(resolveEmissionEntryDate({ ...defaults, occurredOn: "2026-09-01" })).toBe("2026-09-01");
    expect(() => validateEmissionEntry({ ...args(), occurredOn: "2026-09-01" })).toThrow("before");
  });
  it.each([undefined, "2099-01-01", "2020-01-01"])("single ignores the supplied date %s", (occurredOn) => {
    expect(resolveEmissionEntryDate({ ...defaults, entryPolicy: "single", occurredOn })).toBe("2026-10-01");
  });
});

it("accepts a clamped future batch start only as a server-defaulted date", () => {
  const date = { occurredOn: "2026-10-20", batchStartDate: "2026-10-20", timezone: "UTC",
    now: new Date("2026-10-16T12:00:00Z") };
  expect(() => validateEntryDate({ ...date, dateDefaulted: true })).not.toThrow();
  expect(() => validateEntryDate(date)).toThrow("future");
  expect(() => validateEntryDate({ ...date, occurredOn: "2026-10-21", dateDefaulted: true })).toThrow("future");
});
