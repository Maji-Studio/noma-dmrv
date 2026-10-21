import { expect, it } from "vitest";
import sandboxFixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import culaFixture from "../../../tests/fixtures/isometric/cula-template-2026-10-15.json";
import enrichment from "../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";
import type { AggregatedProductionData } from "@/lib/isometric/utils/aggregation";
import type { IsometricComponentBlueprint } from "@/lib/isometric/projects";
import { resolveTemplateInputs } from "./removal-template-inputs";
import { EMPTY_REMOVAL_LINE } from "@/lib/certification/emission-entry-messages";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";

const sandbox = sandboxFixture as GhgEntryTemplate;
const cula = culaFixture as GhgEntryTemplate;

const agg: AggregatedProductionData = {
  weightedOrganicCarbonPercent: 70, weightedHToCorgRatio: null, weightedOToCorgRatio: null,
  totalBiocharDryMassKg: 200, totalFeedstockDryMassKg: 500,
  totalStartupDieselLitres: 5, totalGensetDieselLitres: 10, totalDieselLitres: 15, totalElectricityKwh: 20,
  feedstockTransportMassDistanceTonneKm: 40, biocharTransportMassDistanceTonneKm: 30, sampleTransportMassDistanceTonneKm: 0,
  earliestStartTime: new Date("2026-10-01"), latestEndTime: new Date("2026-10-01"), sourceProductionRunIds: ["run-1"], warnings: [],
};
const blueprintsByKey = new Map((enrichment.blueprints as IsometricComponentBlueprint[]).map((blueprint) => [blueprint.key, blueprint]));
// The enrichment fixture omits Cula's legacy blueprint. Supply its catalog wire
// contract as mock registry metadata; template identity and inputs remain untouched.
blueprintsByKey.set("carbon_rich_substance_sequestration", {
  key: "carbon_rich_substance_sequestration",
  inputs: [
    { input_key: "carbon_content", quantity_kind: "dimensionless", compatible_unit: "dimensionless", data_shape: "SCALAR" },
    { input_key: "product_mass", quantity_kind: "mass", compatible_unit: "kg", data_shape: "SCALAR" },
  ],
} as IsometricComponentBlueprint);
function compile(template: GhgEntryTemplate, lineSources: LineSources) {
  expect(validateLineSources(normalizeTemplateDefinition(template), lineSources)).toEqual([]);
  expect(findUnbindableTemplateInputs(template, { lineSources })).toEqual([]);
  return resolveTemplateInputs({ template, lineSources, blueprintsByKey, agg,
    externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], omitProductionComponents: false,
  });
}

it("keeps the shared Isometric-editor guidance for an unset fixed value during compilation", () => {
  const changed = structuredClone(sandbox);
  changed.groups = changed.groups.filter((group) => group.key === "pyrolysis");
  changed.groups[0].components = changed.groups[0].components.filter((component) => component.blueprint_key === "grid_electricity_use");
  changed.groups[0].components[0].inputs.find((input) => input.type === "fixed")!.datapoint_id = null;
  const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(changed) });
  expect(() => compile(changed, lineSources)).toThrow(REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint);
});

it.each([["sandbox 15 Oct", sandbox], ["Cula", cula]] as const)("compiles supported automatic lines from %s", (_, fixture) => {
  const definition = normalizeTemplateDefinition(fixture);
  const lineSources = resolveLineSources({ definition });
  const findings = findUnbindableTemplateInputs(fixture, { lineSources });
  const blockedIds = new Set(findings.map((finding) => finding.componentId));
  // PR 1 deliberately retains entry-only and legacy paired-transport blockers.
  // Assert their diagnostics before exercising every automatic line already supported.
  const automaticIds = definition.groups.flatMap((group) => group.components.filter((component) => lineSources[component.id].automaticSource).map((component) => component.id));
  for (const finding of findings) {
    if (automaticIds.includes(finding.componentId)) expect(finding).toMatchObject({ blueprintKey: "transport", reason: "unmapped" });
  }
  const automaticTemplate = { ...fixture, groups: fixture.groups.map((group) => ({ ...group,
    components: group.components.filter((component) => automaticIds.includes(component.id) && !blockedIds.has(component.id)),
  })) };
  const result = compile(automaticTemplate, lineSources);
  const diesel = result.monitored.filter((input) => input.componentBlueprintKey === "fuel_usage_by_volume");
  expect(diesel.map((input) => input.quantity).sort((a, b) => a.magnitude - b.magnitude)).toEqual([
    { magnitude: agg.totalStartupDieselLitres, unit: "l" }, { magnitude: agg.totalGensetDieselLitres, unit: "l" },
  ]);
  expect(result.monitored.every((input) => automaticIds.includes(input.removalTemplateComponentId))).toBe(true);
  if (fixture.id === cula.id) {
    expect(result.monitored).toContainEqual(expect.objectContaining({ inputKey: "product_mass", quantity: { magnitude: agg.totalBiocharDryMassKg, unit: "kg" } }));
    expect(result.monitored).toContainEqual(expect.objectContaining({ inputKey: "carbon_content", quantity: { magnitude: 0.7, unit: "dimensionless" } }));
  } else {
    expect(result.monitored).toContainEqual(expect.objectContaining({ inputKey: "electricity_use", quantity: { magnitude: agg.totalElectricityKwh, unit: "kWh" } }));
    expect(result.monitored).toContainEqual(expect.objectContaining({ quantity: { magnitude: agg.feedstockTransportMassDistanceTonneKm, unit: "tonne * km" } }));
  }
});

it("compiles a carried component moved between compatible group instances without mapping edits", () => {
  const original = structuredClone(sandbox);
  original.groups = original.groups.filter((group) => group.key === "pyrolysis");
  const definition = normalizeTemplateDefinition(original);
  const previous = { definition, lineSources: resolveLineSources({ definition }) };
  const baseline = compile(original, previous.lineSources);
  const moved = structuredClone(original);
  const source = moved.groups[0];
  const component = source.components.find((line) => line.blueprint_key === "fuel_usage_by_volume")!;
  source.components = source.components.filter((line) => line.id !== component.id);
  // A group identity may change while retaining the catalog's permitted role key.
  moved.groups.push({ ...source, id: "compatible-pyrolysis-group", display_name: "Other pyrolysis group", components: [component] });
  const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(moved), previous });
  expect(lineSources[component.id]).toEqual({ ...previous.lineSources[component.id], origin: "carried" });
  const compiled = compile(moved, lineSources);
  const byId = (inputs: typeof compiled.monitored) => [...inputs].sort((a, b) => a.removalTemplateComponentId.localeCompare(b.removalTemplateComponentId));
  expect(byId(compiled.monitored)).toEqual(byId(baseline.monitored));
  expect(compiled.datapointBodyByKey).toEqual(baseline.datapointBodyByKey);
});

it("refuses stored inputs whose reviewed contract has no automatic source", () => {
  const template = structuredClone(cula);
  template.groups = template.groups.filter((group) => group.key === "co2-stored");
  const sources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  expect(compile(template, sources).monitored.map((input) => input.inputKey).sort()).toEqual(["carbon_content", "product_mass"]);
  for (const contract of Object.values(sources)) { delete contract.automaticSource; contract.entryPolicy = "none"; }
  expect(findUnbindableTemplateInputs(template, { lineSources: sources }).map((finding) => finding.inputKey).sort()).toEqual(["carbon_content", "product_mass"]);
  expect(() => compile(template, sources)).toThrow();
});
it("leaves incomplete template reads to the template blocker and still refuses input resolution", () => {
  const template = structuredClone(sandbox);
  template.groups = template.groups.filter((group) => group.key === "pyrolysis");
  const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  expect(findUnbindableTemplateInputs(template, { lineSources, enrichmentComplete: false })).toEqual([]);
  expect(() => resolveTemplateInputs({ template, lineSources, enrichmentComplete: false, blueprintsByKey, agg,
    externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], omitProductionComponents: true,
  })).toThrow(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
});

// Entry compilation uses the real template/blueprint fixtures and the same pure selection as context.
import { deriveRemovalEntryContributions, type RemovalEntryFact } from "@/lib/certification/removal-emission-contributions";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
blueprintsByKey.set("metered_energy_based_ci_emissions", {
  key: "metered_energy_based_ci_emissions", inputs: [
    { input_key: "initial_readout", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" },
    { input_key: "final_readout", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" },
  ],
} as IsometricComponentBlueprint);
function compileEntries(blueprintKey: string, paired = false, followup = false, zero = false) {
  const template = structuredClone(blueprintKey === "metered_energy_based_ci_emissions" ? cula : sandbox);
  const group = template.groups.find((group) => group.components.some((component) => component.blueprint_key === blueprintKey))!;
  const component = group.components.find((component) => component.blueprint_key === blueprintKey)!;
  template.groups = [{ ...group, components: [component] }];
  const sources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  sources[component.id] = paired ? { scope: "operating", entryPolicy: "single", origin: "reviewed" } : sources[component.id];
  const blueprint = blueprintsByKey.get(blueprintKey)!;
  const inputs = component.inputs.filter((input) => input.type === "monitored").map((input, index) => ({ inputKey: input.input_key,
    magnitude: String(index + 2), unit: canonicalUnit(input.quantity_kind, blueprint.inputs.find((item) => item.input_key === input.input_key)!.compatible_unit)! }));
  const entry: RemovalEntryFact = { id: "entry", creditBatchId: "batch", componentId: component.id, contentRevision: 3,
    kind: zero ? "zero" : "value", lineRule: paired ? "single" : "additive", occurredOn: "2026-01-01", deletedAt: null, sentByRemovalId: null,
    confirmedForRemovalId: zero ? "removal" : null, sendReservedBySubmissionId: null, counts: true, evidenceDocumentIds: zero ? [] : ["file"], values: zero ? [] : inputs };
  const window = { start: "2026-01-01", end: "2026-02-01" };
  const contributions = deriveRemovalEntryContributions({ removalId: "removal", memberBatchIds: ["batch"], window,
    contenders: [{ contenderKind: "draft", removalId: "removal", createdAt: "2026-01-01", creditBatchIds: ["batch"], window }],
    entries: [entry], lineSources: sources, monitoredInputs: inputs.map((input) => ({ ...input, componentId: component.id })) });
  return resolveTemplateInputs({ template, lineSources: sources, entryContributions: contributions, blueprintsByKey, agg,
    externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], omitProductionComponents: followup });
}
it("adds entries to automatic electricity", () => {
  expect(compileEntries("grid_electricity_use").monitored[0].quantity.magnitude).toBe(22);
});
it("retains entry-only production components on follow-ups without resending automatic values", () => {
  const result = compileEntries("grid_electricity_use", false, true);
  expect(result.monitored[0].quantity.magnitude).toBe(2);
  expect(result.omittedTemplateComponentIds).toEqual([]);
});
it("compiles gas concentration and mass flow from the same single entry", () => {
  expect(compileEntries("ghg_direct_emissions", true).monitored.map((input) => input.quantity.magnitude)).toEqual([2, 3]);
});

// No environment input exists anymore: an empty operating component is blocked the same way everywhere.
it("blocks an empty operating component until recorded", () => {
  const template = structuredClone(sandbox);
  const group = template.groups.find((group) => group.components.some((component) => component.blueprint_key === "ghg_direct_emissions"))!;
  const component = group.components.find((component) => component.blueprint_key === "ghg_direct_emissions")!;
  template.groups = [{ ...group, components: [component] }];
  const lineSources: LineSources = { [component.id]: { scope: "operating", entryPolicy: "single", origin: "reviewed" } };
  expect(() => resolveTemplateInputs({ template, lineSources, blueprintsByKey, agg,
    externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], omitProductionComponents: false,
    entryContributions: { manifest: [], inputs: [], entrySet: [], selectedEntryIds: [], sentSingleComponentIds: [], blockers: [] },
  })).toThrow(EMPTY_REMOVAL_LINE);
});

it("compiles a Removal-confirmed zero with no evidence", () => {
  const result = compileEntries("ghg_direct_emissions", true, false, true);
  expect(result.monitored.map((input) => input.quantity.magnitude)).toEqual([0, 0]);
  expect([...result.datapointBodyByKey.values()].every((body) => body.source_ids?.length === 0)).toBe(true);
});

it("keeps initial and final meter readings together from one entry", () => {
  expect(compileEntries("metered_energy_based_ci_emissions", true).monitored.map((input) => input.quantity.magnitude)).toEqual([2, 3]);
});
it("omits an already-sent single component on a follow-up", () => {
  const template = structuredClone(sandbox);
  const group = template.groups.find((group) => group.components.some((component) => component.blueprint_key === "ghg_direct_emissions"))!;
  const component = group.components.find((component) => component.blueprint_key === "ghg_direct_emissions")!;
  template.groups = [{ ...group, components: [component] }];
  const result = resolveTemplateInputs({ template, lineSources: { [component.id]: { scope: "operating", origin: "reviewed", entryPolicy: "single" } },
    entryContributions: { manifest: [], inputs: [], entrySet: [], selectedEntryIds: [], sentSingleComponentIds: [component.id], blockers: [] },
    blueprintsByKey, agg, externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], omitProductionComponents: true });
  expect(result.monitored).toEqual([]);
  expect(result.omittedTemplateComponentIds).toEqual([component.id]);
});

import { resolveRemovalTemplate } from "./resolve-removal-template";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import type { BatchEmissionContext } from "./batch-emission-context";
it.each([false, true])("runs follow-up line derivation through compilation, including mixed ownership (%s)", (mixed) => {
  const template = structuredClone(sandbox);
  const allSources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  template.groups = template.groups.map((group) => ({ ...group, components: group.components.filter((component) =>
    ["run-electricity", "delivery-transport"].includes(allSources[component.id]?.automaticSource ?? "")),
  })).filter((group) => group.components.length);
  const sources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  const facility = { facilityTimezone: "UTC", templatesById: { [template.id]: { template, observation: { lineSources: sources },
    enrichmentProblems: [], lineSourceProblems: [], blueprintsForTemplate: [], unresolvedBlueprintKeys: [], requiredTransportCategories: [],
  } } } as unknown as FacilityCertifierFacts;
  const contributions = deriveRemovalEntryContributions({ removalId: "r", memberBatchIds: ["batch"], window: null,
    contenders: [], entries: [], lineSources: sources, monitoredInputs: [] });
  const batchFacts: BatchEmissionContext = { batch: { entries: [], previousObservations: new Map(),
    automaticFigures: { "delivery-transport": { magnitude: "12", unit: "km * tonne" } }, omittedAutomaticSources: ["run-electricity"],
  } };
  if (mixed) batchFacts.current = { entries: [], previousObservations: new Map(), automaticFigures: {
    "run-electricity": { magnitude: String(agg.totalElectricityKwh), unit: "kWh" }, "delivery-transport": { magnitude: "12", unit: "km * tonne" },
  } };
  const resolved = resolveRemovalTemplate(Object.keys(batchFacts).map((id) => ({ id, removalTemplateId: template.id })), facility, batchFacts, contributions);
  expect(resolved.emissionLines).toHaveLength(mixed ? 4 : 2);
  expect(resolved.emissionLines!.every((line) => !line.blocker)).toBe(true);
  const result = resolveTemplateInputs({ template, lineSources: sources, emissionLines: resolved.emissionLines, entryContributions: contributions,
    blueprintsByKey, agg, externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], omitProductionComponents: !mixed });
  expect(result.omittedTemplateComponentIds).toHaveLength(mixed ? 0 : 1);
  expect(result.monitored).toHaveLength(mixed ? 2 : 1);
  expect(result.monitored.find((input) => sources[input.removalTemplateComponentId].automaticSource === "delivery-transport")!.quantity.magnitude).toBe(agg.biocharTransportMassDistanceTonneKm);
});
it("sends an additive entry alone for a null automatic aggregate but refuses an invalid non-null aggregate", () => {
  const previous = agg.totalElectricityKwh;
  try {
    agg.totalElectricityKwh = null as never;
    expect(compileEntries("grid_electricity_use").monitored[0].quantity.magnitude).toBe(2);
    agg.totalElectricityKwh = Number.NaN;
    expect(() => compileEntries("grid_electricity_use")).toThrow();
  } finally { agg.totalElectricityKwh = previous; }
});
