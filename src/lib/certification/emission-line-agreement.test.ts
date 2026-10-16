import { resolveRemovalTemplate } from "@/fn/certification/resolve-removal-template";
import type { FacilityCertifierFacts } from "@/fn/certification/facility-certifier-facts";
import { expect, it } from "vitest";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import enrichment from "../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { resolveTemplateInputs } from "@/fn/certification/removal-template-inputs";
import { aggregateProductionRuns, type AggregatedProductionData, type ProductionRunForCertification } from "@/lib/isometric/utils/aggregation";
import type { IsometricComponentBlueprint } from "@/lib/isometric";
import { deriveBatchEmissionLines } from "./emission-lines";
import { buildRemovalRequirementsChecklist, deriveRemovalReadiness, type RemovalReadinessFacts } from "./readiness";

const original = fixture as GhgEntryTemplate;
const automatic = original.groups.find((group) => group.key === "pyrolysis")!.components.find((line) => line.blueprint_key === "grid_electricity_use")!;
const storageGroup = original.groups.find((group) => group.key === "co2-stored")!;
const cases = [
  ["automatic", undefined, undefined], ["unassigned", "lineNeedsReview", "unassigned"],
  ["proposed", "lineNeedsReview", "unassigned"], ["forbidden", "forbiddenLine", "project-scope"],
  ["ambiguous", "lineNeedsReview", "ambiguous"], ["entry-only", "lineHasNoSource", "unmapped"],
  ["unsupported", "lineNeedsSetup", "unmapped"], ["fixed-only", undefined, undefined], ["sequestration", undefined, undefined],
] as const;

it.each(cases)("coverage, readiness and submission agree for %s", (name, code, reason) => {
  const template = structuredClone(original);
  const group = structuredClone(name === "sequestration" ? storageGroup : original.groups.find((group) => group.key === "pyrolysis")!);
  group.components = [structuredClone(name === "sequestration" ? storageGroup.components[0] : automatic)];
  template.groups = [group];
  const component = group.components[0];
  const sources: LineSources = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  const contract = sources[component.id];
  if (name === "unassigned") delete sources[component.id];
  if (name === "proposed") contract.origin = "proposed";
  if (name === "forbidden") sources[component.id] = { scope: "forbidden", entryPolicy: "none", origin: "reviewed" };
  if (name === "entry-only") delete contract.automaticSource;
  if (name === "unsupported") {
    component.inputs = [{ ...component.inputs.find((input) => input.type === "monitored")!, input_key: "unsupported" }];
    sources[component.id] = { scope: "operating", entryPolicy: "none", origin: "reviewed" };
  }
  if (name === "fixed-only") {
    component.inputs = component.inputs.filter((input) => input.type === "fixed");
    sources[component.id] = { scope: "operating", entryPolicy: "none", origin: "reviewed" };
  }
  if (name === "ambiguous") {
    group.components.push({ ...structuredClone(component), id: "duplicate" });
    sources.duplicate = { ...contract };
  }
  const lines = deriveBatchEmissionLines({ definition: normalizeTemplateDefinition(template), lineSources: sources, problems: [], enrichmentComplete: true, automaticFigures: {}, entries: [] });
  const blockedIds = lines.filter((line) => line.blocker).map((line) => line.componentId);
  const coverage = findUnbindableTemplateInputs(template, { lineSources: sources, allowPeriodInputStub: true });
  expect([...new Set(coverage.map((finding) => finding.componentId))].sort()).toEqual(blockedIds.sort());
  expect(lines[0].blocker?.code).toBe(code);
  expect(coverage[0]?.reason).toBe(reason);
  const resolved = resolveRemovalTemplate([{ removalTemplateId: template.id }], {
    templatesById: { [template.id]: { template, observation: { lineSources: sources }, enrichmentProblems: [],
      lineSourceProblems: validateLineSources(normalizeTemplateDefinition(template), sources),
      blueprintsForTemplate: [], unresolvedBlueprintKeys: [], unbindableTemplateInputs: coverage, requiredTransportCategories: [],
    } },
  } as unknown as FacilityCertifierFacts);
  expect(resolved.emissionLines?.filter((line) => line.blocker).map((line) => line.componentId).sort()).toEqual(blockedIds);
  // The typed blocker rides on the line; preparation keeps the coverage text
  // that names the component as the first refusal, with the bundle prepared.
  if (name === "forbidden") expect(resolved.templateBlockers.map((blocker) => blocker.code)).not.toContain("forbiddenLine");
  const facts: RemovalReadinessFacts = { local: null, lockInFlight: false, hasOrgCredentials: true, hasMapping: true, hasRemovalTemplate: true,
    unresolvedBlueprintKeys: [], unbindableTemplateInputs: coverage, hasSubmittableRuns: true, requiredTransport: [], feedstockTypeMappingGaps: [],
    templateBlockers: resolved.templateBlockers,
    emissionLineBlockers: resolved.emissionLines?.flatMap((line) => line.blocker ? [line.blocker] : []),
  };
  expect(deriveRemovalReadiness(facts).state === "ready").toBe(!code);
  expect(buildRemovalRequirementsChecklist(facts).find((check) => check.key === "template")?.status).toBe(code ? "unmet" : "met");
  const agg = { ...aggregateProductionRuns([{ id: "run", code: "RUN", startTime: new Date("2026-10-01"), endTime: new Date("2026-10-02"), electricityKwh: 10 } as ProductionRunForCertification]), weightedOrganicCarbonPercent: null, weightedHToCorgRatio: null, weightedOToCorgRatio: null } satisfies AggregatedProductionData;
  const compile = () => resolveTemplateInputs({ template, lineSources: sources, blueprintsByKey: new Map((enrichment.blueprints as IsometricComponentBlueprint[]).map((blueprint) => [blueprint.key, blueprint])), agg,
    externalProjectId: template.project_id, sourceIds: [], sourceBindingPlan: [], allowPeriodInputStub: true, omitProductionComponents: false });
  if (code) expect(compile).toThrow(lines[0].blocker!.message);
  else expect(compile).not.toThrow();
});

it("keeps the whole mixed template's blocking set identical to each case", () => {
  const template = structuredClone(original);
  const pyrolysis = template.groups.find((group) => group.key === "pyrolysis")!;
  const diesel = pyrolysis.components.find((component) => component.blueprint_key === "fuel_usage_by_volume")!;
  const bootstrap = resolveLineSources({ definition: normalizeTemplateDefinition(template) });
  const sources: LineSources = {};
  pyrolysis.components = cases.filter(([name]) => name !== "sequestration").map(([name]) => {
    const line = structuredClone(name === "ambiguous" ? diesel : automatic);
    line.id = name;
    sources[name] = { ...bootstrap[name === "ambiguous" ? diesel.id : automatic.id], origin: "reviewed" };
    if (name === "unassigned") delete sources[name];
    if (name === "proposed") sources[name] = { scope: "unassigned", entryPolicy: "none", origin: "proposed" };
    if (name === "forbidden") sources[name] = { scope: "forbidden", entryPolicy: "none", origin: "reviewed" };
    if (name === "entry-only") delete sources[name].automaticSource;
    if (name === "unsupported" || name === "fixed-only") {
      sources[name] = { scope: "operating", entryPolicy: "none", origin: "reviewed" };
      line.inputs = name === "fixed-only" ? line.inputs.filter((input) => input.type === "fixed")
        : [{ ...line.inputs.find((input) => input.type === "monitored")!, input_key: "unsupported" }];
    }
    return line;
  });
  const duplicate = { ...structuredClone(diesel), id: "ambiguous-peer" };
  pyrolysis.components.push(duplicate);
  sources[duplicate.id] = { ...sources.ambiguous };
  const storage = structuredClone(storageGroup);
  storage.components = [storage.components[0]];
  sources[storage.components[0].id] = bootstrap[storage.components[0].id];
  template.groups = [pyrolysis, storage];
  const lines = deriveBatchEmissionLines({ definition: normalizeTemplateDefinition(template), lineSources: sources, problems: [], enrichmentComplete: true, entries: [], automaticFigures: {} });
  const expected = [...cases.filter(([, code]) => !!code).map(([name]) => name), "ambiguous-peer"].sort();
  expect(lines.filter((line) => line.blocker).map((line) => line.componentId).sort()).toEqual(expected);
  expect([...new Set(findUnbindableTemplateInputs(template, { lineSources: sources }).map((finding) => finding.componentId))].sort()).toEqual(expected);
});
