import { describe, expect, it } from "vitest";
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
describe("batch emission line states", () => {
  it.each([
    ["empty", false, []], ["filled", true, []],
    ["missingEvidence", true, [{ hasEvidence: false }]],
    ["filled", false, [{}]], ["confirmedZero", false, [{ kind: "zero", total: null, hasEvidence: false }]],
    ["empty", false, [{ counts: false, hasEvidence: false }]],
    ["filled", false, [{ kind: "zero", total: null }, {}]],
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
    expect(() => deriveBatchEmissionLines(f)).toThrow("units must match");
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
  it("exports the agreed labels", () => {
    expect(EMISSION_LINE_STATE_LABELS).toEqual({ filled: "Recorded", empty: "Not recorded", missingEvidence: "File missing", needsReview: "Needs review", needsSetup: "Needs setup", confirmedZero: "Recorded as zero" });
  });
});

it.each(["single-with-automatic-source", "foreign-automatic-source", "disallowed-entry-policy", "ambiguous", "missing-contract", "unassigned"] as const)("every supplied %s problem wins over recorded figures and entries", (code) => {
  const f = facts(); const componentId = f.definition.groups[0].components[0].id;
  f.problems = [{ componentId, code }];
  f.automaticFigures = { "run-electricity": { magnitude: "10", unit: "kWh" } };
  f.entries = [entry(f, { hasEvidence: false })];
  expect(deriveBatchEmissionLines(f)[0]).toMatchObject({ state: "needsReview", blocker: { code: "lineNeedsReview", fixTarget: "templateLineReview" } });
});
