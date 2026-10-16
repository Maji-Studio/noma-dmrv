import { expect, it } from "vitest";
import sandboxFixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import culaFixture from "../../../tests/fixtures/isometric/cula-template-2026-10-15.json";
import enrichment from "../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";
import type { AggregatedProductionData } from "@/lib/isometric/utils/aggregation";
import type { IsometricComponentBlueprint } from "@/lib/isometric/projects";
import { resolveTemplateInputs } from "./removal-template-inputs";
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
    externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], allowPeriodInputStub: false, omitProductionComponents: false,
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

it.each([["sandbox 15 Oct", sandbox], ["Cula", cula]] as const)("compiles supported automatic lines from %s without a global shape assumption", (_, fixture) => {
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
it("blocks incomplete template reads through the same line decision", () => {
  const template = structuredClone(sandbox);
  template.groups = template.groups.filter((group) => group.key === "pyrolysis");
  const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  expect(findUnbindableTemplateInputs(template, { lineSources, enrichmentComplete: false }).every((finding) => finding.reason === "unassigned")).toBe(true);
  expect(() => resolveTemplateInputs({ template, lineSources, enrichmentComplete: false, blueprintsByKey, agg,
    externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], allowPeriodInputStub: true, omitProductionComponents: true,
  })).toThrow(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
});
