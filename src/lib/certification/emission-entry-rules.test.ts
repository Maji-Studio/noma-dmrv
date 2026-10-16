import { describe, expect, it } from "vitest";
import { emissionEntryCounts, validateEmissionEntry, multiplyEntryDecimals, type EntryObservation, type EntryValueInput } from "./emission-entry-rules";

export function observation(): EntryObservation {
  return { externalTemplateId: "template", definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Group", description: "", components: [{ id: "line", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use", inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } }, lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } } };
}
const value: EntryValueInput = { inputKey: "electricity_use", quantityKind: "energy", magnitude: "0.100000000000000001", unit: "kWh" };
function args() { return { observation: observation(), componentId: "line", values: [value], occurredOn: "2026-10-15", batchStartDate: "2026-10-15", timezone: "America/Los_Angeles", now: new Date("2026-10-16T01:00:00Z"), activeValueCount: 0 }; }
describe("entry guards", () => {
  it("accepts the batch start date and additive siblings west of UTC", () => {
    expect(validateEmissionEntry({ ...args(), activeValueCount: 8 }).lineRule).toBe("additive");
  });
  it.each(["2026-10-14", "2026-10-16", "2026-02-30"])("refuses out-of-window or invalid date %s", occurredOn => {
    expect(() => validateEmissionEntry({ ...args(), occurredOn })).toThrow();
  });
  it("requires the pinned component", () => { expect(() => validateEmissionEntry({ ...args(), componentId: "missing" })).toThrow("no longer available"); });
  it.each(["forbidden", "unassigned"] as const)("refuses %s scope", scope => {
    const input = args(); input.observation.lineSources.line.scope = scope;
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
  });
  it("refuses none and unreviewed proposals", () => {
    const input = args(); input.observation.lineSources.line.entryPolicy = "none";
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
    input.observation.lineSources.line.entryPolicy = "additive"; input.observation.lineSources.line.origin = "proposed";
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
  });
  it.each(["-1", "NaN", "Infinity", "1e3", "", "1,2"])("refuses magnitude %s", magnitude => {
    expect(() => validateEmissionEntry({ ...args(), values: [{ ...value, magnitude }] })).toThrow("decimal");
  });
  it.each([{ inputKey: "wrong" }, { quantityKind: "mass" as const }, { unit: "kg" }, { unit: "kilowatt_hour" }])("refuses mismatched input %j", patch => {
    expect(() => validateEmissionEntry({ ...args(), values: [{ ...value, ...patch }] })).toThrow();
  });
  it("refuses an unread input unit", () => {
    const input = args(); input.observation.enrichment.line.electricity_use = { status: "unknown" };
    expect(() => validateEmissionEntry(input)).toThrow("Read the template input units");
  });
  it("requires all inputs exactly once", () => {
    expect(() => validateEmissionEntry({ ...args(), values: [] })).toThrow();
    expect(() => validateEmissionEntry({ ...args(), values: [value, value] })).toThrow();
  });
  it("accepts paired readings once, refuses a second single entry and automatic sources", () => {
    const input = args(); const line = input.observation.definition.groups[0].components[0];
    line.inputs = ["initial_readout", "final_readout"].map(key => ({ key, type: "monitored", quantityKind: "energy" }));
    input.observation.lineSources.line.entryPolicy = "single";
    input.observation.enrichment.line = { initial_readout: { unit: "kWh" }, final_readout: { unit: "kWh" } };
    input.values = line.inputs.map(field => ({ ...value, inputKey: field.key }));
    expect(validateEmissionEntry(input).lineRule).toBe("single");
    expect(() => validateEmissionEntry({ ...input, values: [input.values[0], input.values[0]] })).toThrow("each input");
    expect(() => validateEmissionEntry({ ...input, activeValueCount: 1 })).toThrow("already has");
    input.observation.lineSources.line.automaticSource = "run-electricity";
    expect(() => validateEmissionEntry(input)).toThrow("does not allow");
  });
  it("validates mass-distance detail by exact multiplication", () => {
    const input = args(); const line = input.observation.definition.groups[0].components[0];
    line.blueprintKey = "mass_distance_based_ci_emissions";
    line.inputs = [{ key: "mass_distance", type: "monitored", quantityKind: "mass_distance" }];
    input.observation.enrichment.line = { mass_distance: { unit: "tonne * km" } };
    input.values = [{ inputKey: "mass_distance", quantityKind: "mass_distance", magnitude: "0.02", unit: "km * tonne", massDistanceDetail: { mass: { magnitude: "0.1", unit: "tonne" }, distance: { magnitude: "0.2", unit: "km" } } }];
    expect(validateEmissionEntry(input).lineRule).toBe("additive");
    expect(() => validateEmissionEntry({ ...input, values: [{ ...input.values[0], massDistanceDetail: null }] })).toThrow("Enter the mass and distance");
    input.values[0].magnitude = "0.03";
    expect(() => validateEmissionEntry(input)).toThrow("must match");
    expect(multiplyEntryDecimals("9007199254740993.1", "0.2")).toBe("1801439850948198.62");
  });
});
describe("entries after template changes", () => {
  it("counts unchanged and cosmetic lines", () => {
    const before = observation(); const after = structuredClone(before);
    expect(emissionEntryCounts(before, after, "line").counts).toBe(true);
    after.definition.groups[0].components[0].displayName = "Power";
    expect(emissionEntryCounts(before, after, "line").counts).toBe(true);
  });
  it("requires confirmation for convertible units and fixed-factor changes", () => {
    const before = observation(); const after = structuredClone(before);
    after.enrichment.line.electricity_use = { unit: "Wh" };
    expect(emissionEntryCounts(before, after, "line")).toMatchObject({ counts: false, canConfirm: true });
    expect(emissionEntryCounts(after, after, "line").counts).toBe(true);
  });
  it.each(["removed", "kind", "policy", "scope", "template", "unknown-unit"])("requires re-entry after %s", change => {
    const before = observation(); const after = structuredClone(before);
    if (change === "removed") after.definition.groups[0].components = [];
    if (change === "kind") after.definition.groups[0].components[0].inputs[0].quantityKind = "mass";
    if (change === "policy") after.lineSources.line.entryPolicy = "none";
    if (change === "scope") after.lineSources.line.scope = "forbidden";
    if (change === "template") after.externalTemplateId = "different";
    if (change === "unknown-unit") after.enrichment.line.electricity_use = { status: "unknown" };
    expect(emissionEntryCounts(before, after, "line")).toMatchObject({ counts: false, canConfirm: false });
  });
});
