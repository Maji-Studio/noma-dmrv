import { buildCreditBatchOpenItems, openItemText } from "@/lib/credit-batches/open-items";
import { readOnlyOpenItems } from "@/lib/credit-batches/batch-page";
import { describe, expect, it } from "vitest";
import { batchAutomaticFigures } from "./batch-automatic-figures";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { deriveBatchEmissionLines, EMISSION_LINE_STATE_LABELS, type BatchEmissionLineFacts, type EmissionLineEntryFact } from "./emission-lines";

function facts(): BatchEmissionLineFacts {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  const group = definition.groups.find((group) => group.key === "pyrolysis")!;
  group.components = group.components.filter((component) => component.blueprintKey === "grid_electricity_use");
  definition.groups = [group];
  return { definition, lineSources: resolveLineSources({ definition }), problems: [], enrichmentComplete: true, automaticFigures: {}, entries: [] };
}
function entry(f: BatchEmissionLineFacts, overrides: Partial<EmissionLineEntryFact> = {}): EmissionLineEntryFact {
  return { componentId: f.definition.groups[0].components[0].id, counts: true, kind: "value", hasEvidence: true, total: { magnitude: "0.2", unit: "kWh" }, ...overrides };
}
it("returns the raw template order and group names without changing the normalized definition", () => {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  const before = structuredClone(definition);
  const sources = resolveLineSources({ definition });
  const lineSources = Object.fromEntries(fixture.groups.flatMap((group, groupPosition) =>
    group.components.map((component, position) => [component.id, {
      ...sources[component.id], templateOrder: { groupPosition, position },
    }]),
  ));
  const lines = deriveBatchEmissionLines({ definition, lineSources,
    problems: [], enrichmentComplete: true, automaticFigures: {}, entries: [],
  });
  expect(lines.map((line) => line.componentId)).toEqual(fixture.groups.flatMap((group) => group.components.map((component) => component.id)));
  for (const [index, expected] of fixture.groups.flatMap((group, groupPosition) =>
    group.components.map((component, position) => ({ componentId: component.id,
      groupName: group.display_name, groupPosition, position })),
  ).entries()) expect(lines[index]).toMatchObject(expected);
  expect(definition).toEqual(before);
});
describe("batch emission line states", () => {
  it.each([
    ["empty", false, []], ["filled", true, []],
    ["missingEvidence", true, [{ hasEvidence: false }]],
    ["filled", false, [{}]], ["confirmedZero", false, [{ kind: "zero", confirmedForRemovalId: "removal", total: null, hasEvidence: false }]],
    ["needsReview", false, [{ counts: false, hasEvidence: false }]],
    ["filled", false, [{ kind: "zero", confirmedForRemovalId: "removal", total: null }, {}]],
  ] as const)("derives %s with automatic=%s and entries=%j", (state, automatic, overrides) => {
    const f = facts();
    f.automaticFigures = { "run-electricity": automatic ? { magnitude: "0", unit: "kWh" } : null };
    f.entries = overrides.map((override) => entry(f, override));
    expect(deriveBatchEmissionLines(f)[0].state).toBe(state);
  });
  it("sums decimal strings exactly and excludes non-counting entries", () => {
    const f = facts();
    f.automaticFigures = { "run-electricity": { magnitude: "9007199254740993.1", unit: "kWh" } };
    f.entries = [entry(f), entry(f, { counts: false })];
    expect(deriveBatchEmissionLines(f)[0].total).toEqual({ magnitude: "9007199254740993.3", unit: "kWh" });
  });
  it("does not invent a scalar for paired inputs or add unlike units", () => {
    const f = facts(); f.entries = [entry(f, { total: null })];
    expect(deriveBatchEmissionLines(f)[0].total).toBeNull();
    f.automaticFigures = { "run-electricity": { magnitude: "1", unit: "Wh" } };
    f.entries = [entry(f)];
    expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "needsReview", total: null, blocker: { code: "lineNeedsReview" } });
  });
  it("review and setup take precedence over missing evidence", () => {
    const f = facts(); const id = f.definition.groups[0].components[0].id;
    f.entries = [entry(f, { hasEvidence: false })];
    f.lineSources[id] = { scope: "forbidden", origin: "reviewed", entryPolicy: "none" };
    expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "needsSetup", blocker: { code: "forbiddenLine" } });
    f.enrichmentComplete = false;
    expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "needsReview", blocker: { code: "templateNotFullyRead" } });
  });
  it("keeps entry-only lines blocked until submission supports entries", () => {
    const f = facts(); const id = f.definition.groups[0].components[0].id;
    f.lineSources[id] = { scope: "operating", origin: "reviewed", entryPolicy: "additive" };
    expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "empty", blocker: { code: "lineHasNoSource", message: "Pick another Removal template or ask support to add the mapping." } });
    f.lineSources[id].entryPolicy = "none";
    expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "needsSetup", blocker: { code: "lineNeedsSetup" } });
  });
  it.each([
    ["filled", { kind: "value", hasEvidence: true }],
    ["confirmedZero", { kind: "zero", confirmedForRemovalId: "removal", total: null, hasEvidence: false }],
    ["missingEvidence", { kind: "value", hasEvidence: false }],
  ] as const)("keeps the entry-only source blocker when entries display as %s", (state, overrides) => {
    const f = facts(); const id = f.definition.groups[0].components[0].id;
    f.lineSources[id] = { scope: "operating", origin: "reviewed", entryPolicy: "additive" };
    f.entries = [entry(f, overrides)];
    expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state, blocker: { code: state === "missingEvidence" ? "entryMissingEvidence" : "lineHasNoSource" } });
  });
  it("exports the agreed labels", () => {
    expect(EMISSION_LINE_STATE_LABELS).toEqual({ filled: "Recorded", empty: "Not recorded", missingEvidence: "File missing", needsReview: "Check entry", needsSetup: "Not set up", confirmedZero: "Recorded as zero" });
  });
});

it.each(["single-with-automatic-source", "foreign-automatic-source", "disallowed-entry-policy", "ambiguous", "missing-contract", "unassigned"] as const)("every supplied %s problem wins over recorded figures and entries", (code) => {
  const f = facts(); const componentId = f.definition.groups[0].components[0].id;
  f.problems = [{ componentId, code }];
  f.automaticFigures = { "run-electricity": { magnitude: "10", unit: "kWh" } };
  f.entries = [entry(f, { hasEvidence: false })];
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "needsReview", blocker: { code: "lineNeedsReview", fixTarget: "templateLineReview" } });
});

it.each([
  "Confirm this entry for the changed template component.",
  "Enter the values again for the current template component.",
])("keeps stale entries visible with the action: %s", (reason) => {
  const f = facts();
  f.entries = [entry(f, { counts: false, reason })];
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({
    state: "needsReview", total: null, entries: f.entries,
    blocker: { code: "lineNeedsReview", message: reason },
  });
});

it("keeps a Removal-owned zero confirmed when the line has no automatic figure", () => {
  const f = facts();
  f.entries = [entry(f, { kind: "zero", confirmedForRemovalId: "removal", total: null, hasEvidence: false })];
  f.automaticFigures = { "run-electricity": null };
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "confirmedZero" });
  expect(deriveBatchEmissionLines(f)[0].blocker).toBeUndefined();
  f.lineSources[f.entries[0].componentId] = { scope: "operating", origin: "reviewed", entryPolicy: "additive" };
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "confirmedZero", blocker: { code: "lineHasNoSource" } });
});

it.each(["0", "1"])("uses an automatic figure of %s instead of a Removal-owned zero", (magnitude) => {
  const f = facts();
  f.entries = [entry(f, { kind: "zero", confirmedForRemovalId: "removal", total: null, hasEvidence: false })];
  f.automaticFigures = { "run-electricity": { magnitude, unit: "kWh" } };
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "filled", total: { magnitude, unit: "kWh" } });
});

it("reports the automatic record kind, count and figure independently of entries", () => {
  const f = facts();
  f.automaticRecordCounts = { "run-electricity": 22 };
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({
    records: { source: "productionRuns", count: 22, figure: null }, entryPolicy: "additive",
  });
  f.automaticFigures = { "run-electricity": { magnitude: "18420", unit: "kWh" } };
  const [line] = deriveBatchEmissionLines(f);
  expect(line.records).toEqual({ source: "productionRuns", count: 22, figure: line.automaticFigure });
  f.lineSources[line.componentId] = { scope: "operating", origin: "reviewed", entryPolicy: "additive" };
  expect(deriveBatchEmissionLines(f)[0].records).toBeNull();
});

it("reports catalog transport and stored sources using their record kinds", () => {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  const lines = deriveBatchEmissionLines({ definition, lineSources: resolveLineSources({ definition }),
    problems: [], enrichmentComplete: true, automaticFigures: {}, entries: [],
    automaticRecordCounts: { "feedstock-transport": 3, "delivery-transport": 4, sequestration: 5 },
  });
  expect(lines.find((line) => line.contract?.automaticSource === "feedstock-transport")?.records)
    .toEqual({ source: "transportLegs", count: 3, figure: null });
  expect(lines.find((line) => line.contract?.automaticSource === "delivery-transport")?.records)
    .toEqual({ source: "deliveries", count: 4, figure: null });
  expect(lines.find((line) => line.contract?.automaticSource === "sequestration")?.records)
    .toEqual({ source: "applications", count: 5, figure: null });
});

it("permits counted entry-only values and zeros, but keeps the Removal's empty line blocker", () => {
  const f = facts(); const id = f.definition.groups[0].components[0].id;
  f.lineSources[id] = { scope: "operating", origin: "reviewed", entryPolicy: "additive" };
  f.entriesCanSubmit = true;
  expect(deriveBatchEmissionLines(f)[0].blocker?.code).toBe("lineHasNoSource");
  f.entries = [entry(f)];
  expect(deriveBatchEmissionLines(f)[0].blocker).toBeUndefined();
  f.entries = [entry(f, { kind: "zero", confirmedForRemovalId: "removal", total: null, hasEvidence: false })];
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "confirmedZero" });
  expect(deriveBatchEmissionLines(f)[0].blocker).toBeUndefined();
});

it("discards stale sample automatic facts while retaining additive entries", () => {
  const f = facts();
  const component = f.definition.groups[0].components[0];
  component.blueprintKey = "mass_distance_based_ci_emissions";
  component.inputs = [{ key: "mass_distance", type: "monitored", quantityKind: "mass_distance" }];
  f.definition.groups[0].key = "sampling-required-for-mrv";
  f.lineSources[component.id] = { scope: "operating", automaticSource: "sample-transport", entryPolicy: "additive", origin: "reviewed" };
  f.automaticFigures = { "sample-transport": { magnitude: "20", unit: "km * tonne" } };
  f.automaticRecordCounts = { "sample-transport": 3 };
  f.entries = [entry(f, { total: { magnitude: "5", unit: "km * tonne" } })];
  const [line] = deriveBatchEmissionLines(f);
  expect(line.state).toBe("filled");
  expect(line.entryPolicy).toBe("additive");
  expect(line.total).toEqual({ magnitude: "5", unit: "km * tonne" });
  expect(line.records === null).toBe(true);
  f.entries = [];
  expect(deriveBatchEmissionLines(f)[0].state).toBe("empty");
});


it("records a biomass transport zero with no records when every linked trip is owned elsewhere", () => {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  const automaticFigures = batchAutomaticFigures([], {
    feedstock: [], biochar: [], sample: [], feedstockTransportOwnedElsewhere: true,
  });
  const lines = deriveBatchEmissionLines({ definition, lineSources: resolveLineSources({ definition }),
    problems: [], enrichmentComplete: true, entriesCanSubmit: true, automaticFigures, entries: [],
    automaticRecordCounts: { "feedstock-transport": 0 },
    feedstockTransportCountedOn: [{ creditBatchId: "cb", code: "CB-26-001" }],
  });
  const line = lines.find((line) => line.contract?.automaticSource === "feedstock-transport")!;
  expect(EMISSION_LINE_STATE_LABELS[line.state]).toBe("Recorded");
  expect(line.blocker).toBeUndefined();
  expect(line.records).toEqual({ source: "transportLegs", count: 0, figure: { magnitude: "0", unit: "km * tonne" },
    countedOn: [{ creditBatchId: "cb", code: "CB-26-001" }] });
  expect(line.total).toEqual({ magnitude: "0", unit: "km * tonne" });
});


it("separates missing-file instructions without changing the blocker message", () => {
  const f = facts();
  f.entries = [entry(f, { hasEvidence: false })];
  const [line] = deriveBatchEmissionLines(f);
  expect(line.blocker).toMatchObject({ code: "entryMissingEvidence", message: "Add a file for each emissions entry with a value.", copy: { instruction: "Add a file for each emissions entry with a value." } });
  // Open items also accept a reviewed line carrying this evidence blocker.
  const groups = buildCreditBatchOpenItems({ facilityId: "facility", creditBatchId: "batch", canManage: true,
    emissionLines: [{ ...line, state: "needsReview" }],
  });
  expect(openItemText(groups.check[0])).toBe(line.blocker?.message);
  const [readOnly] = readOnlyOpenItems({ ...groups, waiting: [] }).check;
  expect(openItemText(readOnly)).toBeUndefined();
  expect(readOnly.title).toBe(`${line.displayName}: ${EMISSION_LINE_STATE_LABELS.needsReview}`);
  expect(readOnly.instruction).toBeUndefined();
});


it("leaves a supplied stale-entry reason unsplit", () => {
  const f = facts();
  const instruction = "Confirm this entry for the changed template component.";
  f.entries = [entry(f, { counts: false, reason: instruction })];
  const [line] = deriveBatchEmissionLines(f);
  expect(line.blocker?.message).toBe(instruction);
  expect(line.blocker?.copy).toBeUndefined();
  const groups = buildCreditBatchOpenItems({ facilityId: "facility", creditBatchId: "batch", canManage: true, emissionLines: [line] });
  expect(openItemText(groups.check[0])).toBe(instruction);
  const [readOnly] = readOnlyOpenItems({ ...groups, waiting: [] }).check;
  expect(openItemText(readOnly)).toBeUndefined();
  expect(readOnly.title).toBe(`${line.displayName}: ${EMISSION_LINE_STATE_LABELS.needsReview}`);
});


it("splits the stale-entry fallback instruction when no reason is supplied", () => {
  const f = facts();
  f.entries = [entry(f, { counts: false })];
  const [line] = deriveBatchEmissionLines(f);
  expect(line.blocker?.message).toBe("Enter the values again for the current template component.");
  expect(line.blocker?.copy).toEqual({ instruction: line.blocker?.message });
});
