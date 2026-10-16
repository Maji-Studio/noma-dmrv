import { describe, expect, it, vi } from "vitest";
import sandboxFixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import culaFixture from "../../../tests/fixtures/isometric/cula-template-2026-10-15.json";
import enrichment from "../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, validateLineSources, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import type { IsometricComponentBlueprint } from "@/lib/isometric";
import type { AggregatedProductionData } from "@/lib/isometric/utils/aggregation";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import { resolveRemovalTemplate } from "./resolve-removal-template";
import { prepareRemovalSubmission } from "./removal-submission-prepare";
import { resolveTemplateInputs } from "./removal-template-inputs";
import { buildSubmissionWarnings } from "./submission-warnings";
import { deriveRequiredTransportCategories } from "./certify-transport-coverage";
import type { TransportLegsByCategory } from "./shared";

vi.mock("./durability-measurement-samples", () => ({
  DURABILITY_MEASUREMENT_SAMPLES_ENABLED: true, DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE: "Unavailable.",
}));

const sandbox = sandboxFixture as GhgEntryTemplate;
const cula = culaFixture as GhgEntryTemplate;
const GENSET = "rtc_1KWHFRM4GSBX5Y7A";
const blueprints = [
  ...enrichment.blueprints as IsometricComponentBlueprint[],
  // Mock registry metadata for the Cula legacy storage blueprint absent from
  // the sandbox enrichment fixture. Its template inputs stay unchanged.
  { key: "carbon_rich_substance_sequestration", inputs: [
    { input_key: "carbon_content", quantity_kind: "dimensionless", compatible_unit: "dimensionless", data_shape: "SCALAR" },
    { input_key: "product_mass", quantity_kind: "mass", compatible_unit: "kg", data_shape: "SCALAR" },
  ] } as IsometricComponentBlueprint,
];
const agg: AggregatedProductionData = {
  weightedOrganicCarbonPercent: 70, weightedHToCorgRatio: null, weightedOToCorgRatio: null,
  totalBiocharDryMassKg: 200, totalFeedstockDryMassKg: 500,
  totalStartupDieselLitres: 5, totalGensetDieselLitres: 10, totalDieselLitres: 15, totalElectricityKwh: 20,
  feedstockTransportMassDistanceTonneKm: 40, biocharTransportMassDistanceTonneKm: 30, sampleTransportMassDistanceTonneKm: 0,
  earliestStartTime: new Date("2026-10-01"), latestEndTime: new Date("2026-10-01"), sourceProductionRunIds: ["run-1"], warnings: [],
};

function sources(template: GhgEntryTemplate) {
  return resolveLineSources({ definition: normalizeTemplateDefinition(template) });
}

/** Exclude entry-only functionality and Cula's known unsupported legacy transport. */
function supportedAutomaticTemplate(template: GhgEntryTemplate) {
  const lineSources = sources(template);
  return { ...structuredClone(template), groups: template.groups.map((group) => ({ ...group,
    components: group.components.filter((component) => lineSources[component.id].automaticSource && component.blueprint_key !== "transport"),
  })) };
}

function facilityFacts(template: GhgEntryTemplate, lineSources: LineSources): FacilityCertifierFacts {
  return {
    hasOrgCredentials: true, mapping: { externalProjectId: template.project_id },
    defaultTemplate: { ...template, id: "different-default" },
    templatesById: { [template.id]: {
      template, observation: { lineSources }, enrichmentProblems: [],
      lineSourceProblems: validateLineSources(normalizeTemplateDefinition(template), lineSources),
      blueprintsForTemplate: blueprints, unresolvedBlueprintKeys: [],
      unbindableTemplateInputs: findUnbindableTemplateInputs(template, { lineSources }),
      requiredTransportCategories: deriveRequiredTransportCategories(template),
    } },
  } as unknown as FacilityCertifierFacts;
}

function prepare(template: GhgEntryTemplate, lineSources = sources(template), facilityId = "facility-1") {
  const facts = facilityFacts(template, lineSources);
  const resolved = resolveRemovalTemplate([{ removalTemplateId: template.id }], facts);
  const context = { ...resolved, facilityId, mapping: facts.mapping, hasOrgCredentials: true };
  return { resolved, ...prepareRemovalSubmission(context, { isometricEnvironment: "sandbox" }) };
}

function compile(template: GhgEntryTemplate, lineSources = sources(template), facilityId?: string) {
  const result = prepare(template, lineSources, facilityId);
  expect(result.blockers).toEqual([]);
  expect(result.prepared).not.toBeNull();
  return { ...result, inputs: resolveTemplateInputs({
    template: result.prepared!.removalTemplate, lineSources: result.prepared!.lineSources,
    blueprintsByKey: result.prepared!.blueprintsByKey, externalProjectId: result.prepared!.externalProjectId,
    agg, sourceIds: [], sourceBindingPlan: [], allowPeriodInputStub: true, omitProductionComponents: false,
  }) };
}

describe("pinned-template compilation drift matrix", () => {
  it("resolves and compiles two facilities' distinct pins and contracts in the same run", () => {
    // The full Cula fixture must keep its legacy transport refusal, not silently
    // acquire the sandbox's mass-distance binding.
    const legacy = prepare(cula);
    expect(legacy.blockers).toContainEqual(expect.objectContaining({ code: "templateUnbindable", message: expect.stringContaining("blueprint transport") }));
    const first = supportedAutomaticTemplate(sandbox);
    const second = supportedAutomaticTemplate(cula);
    const a = compile(first, sources(first), "sandbox-facility");
    const b = compile(second, sources(second), "cula-facility");
    expect(a.resolved.removalTemplate?.id).toBe(sandbox.id);
    expect(b.resolved.removalTemplate?.id).toBe(cula.id);
    expect(a.prepared!.externalProjectId).toBe(sandbox.project_id);
    expect(b.prepared!.externalProjectId).toBe(cula.project_id);
    expect(a.resolved.lineSources[GENSET].automaticSource).toBe("run-genset-diesel");
    expect(b.resolved.lineSources[GENSET]).toBeUndefined();
    expect(b.resolved.lineSources.rtc_1M2QJGQS21S0H1G0.automaticSource).toBe("run-genset-diesel");
    expect(a.inputs.monitored).toContainEqual(expect.objectContaining({ inputKey: "electricity_use", quantity: { magnitude: agg.totalElectricityKwh, unit: "kWh" } }));
    expect(b.inputs.monitored).not.toContainEqual(expect.objectContaining({ inputKey: "electricity_use" }));
    expect(b.inputs.monitored).toContainEqual(expect.objectContaining({ inputKey: "product_mass", quantity: { magnitude: agg.totalBiocharDryMassKg, unit: "kg" } }));
    expect(resolveRemovalTemplate([{ removalTemplateId: cula.id }], facilityFacts(first, sources(first))).templateBlockers[0].code).toBe("templateNotFound");
  });

  it("compiles a known component moved between compatible group instances", () => {
    const original = supportedAutomaticTemplate(sandbox);
    const baseline = compile(original);
    const moved = structuredClone(original);
    const group = moved.groups.find((group) => group.key === "pyrolysis")!;
    const component = group.components.find((component) => component.id === GENSET)!;
    group.components = group.components.filter((component) => component.id !== GENSET);
    moved.groups.push({ ...group, id: "other-pyrolysis", components: [component] });
    const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(moved), previous: {
      definition: normalizeTemplateDefinition(original), lineSources: sources(original),
    } });
    expect(compile(moved, lineSources).inputs.datapointBodyByKey).toEqual(baseline.inputs.datapointBodyByKey);
  });

  it("fails closed with review plus exact unsupported-input diagnostics", () => {
    const original = supportedAutomaticTemplate(sandbox);
    const changed = structuredClone(original);
    changed.groups.flatMap((group) => group.components).find((component) => component.id === GENSET)!.inputs.push({
      type: "monitored", input_key: "unknown_pressure", display_name: "Pressure", quantity_kind: "pressure", datapoint_id: null,
    });
    const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(changed), previous: {
      definition: normalizeTemplateDefinition(original), lineSources: sources(original),
    } });
    const result = prepare(changed, lineSources);
    expect(result.prepared).toBeNull();
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["templateLinesNeedReview", "templateUnbindable"]);
    const diagnostic = result.blockers.find((blocker) => blocker.code === "templateUnbindable")!.message;
    for (const detail of ["Generator diesel", GENSET, "fuel_usage_by_volume", "unknown_pressure", "Pick another Removal template or ask support"]) {
      expect(diagnostic).toContain(detail);
    }
  });

  it.each([
    ["biomass-feedstock-transport", "feedstock", "Feedstock transport"],
    ["biochar-transport", "biochar", "Delivery transport"],
  ] as const)("warns when the %s line drops recorded transport", (groupKey, category, label) => {
    const original = supportedAutomaticTemplate(sandbox);
    const changed = structuredClone(original);
    changed.groups.find((group) => group.key === groupKey)!.components = [];
    const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(changed), previous: {
      definition: normalizeTemplateDefinition(original), lineSources: sources(original),
    } });
    const result = compile(changed, lineSources);
    expect(result.resolved.requiredTransportCategories).not.toContain(category);
    const transportLegs: TransportLegsByCategory = { feedstock: [], biochar: [], sample: [] };
    transportLegs[category] = [{ id: "recorded-leg", distanceKm: 20 } as TransportLegsByCategory[typeof category][number]];
    expect(buildSubmissionWarnings({ removalTemplate: result.prepared!.removalTemplate, lineSources, runs: [], lineages: [], transportLegs }))
      .toEqual([expect.stringContaining(`${label} is recorded`)]);
    expect(buildSubmissionWarnings({ removalTemplate: result.prepared!.removalTemplate, lineSources, runs: [], lineages: [] })).toEqual([]);
  });

  it("fails closed when a carried automatic contract moves to an incompatible scope", () => {
    const original = supportedAutomaticTemplate(sandbox);
    const changed = structuredClone(original);
    const group = changed.groups.find((group) => group.key === "pyrolysis")!;
    const component = group.components.find((component) => component.id === GENSET)!;
    group.components = group.components.filter((component) => component.id !== GENSET);
    changed.groups.push({ ...group, id: "storage", key: "biochar-storage", components: [component] });
    const lineSources = resolveLineSources({ definition: normalizeTemplateDefinition(changed), previous: {
      definition: normalizeTemplateDefinition(original), lineSources: sources(original),
    } });
    const result = prepare(changed, lineSources);
    expect(result.prepared).toBeNull();
    expect(result.resolved.templateBlockers.map((blocker) => blocker.code)).toContain("templateLinesNeedReview");
    expect(findUnbindableTemplateInputs(changed, { lineSources })).toContainEqual(expect.objectContaining({ componentId: GENSET }));
  });
});
