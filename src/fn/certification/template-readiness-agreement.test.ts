import { expect, it } from "vitest";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { RemovalCertifyContext } from "./certify-context";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import type { BatchEmissionContext } from "./batch-emission-context";
import { resolveRemovalTemplate } from "./resolve-removal-template";
import { normalizeTemplateDefinition, validateLineSources, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { deriveBatchHealth } from "@/lib/certification/batch-health";
import { buildRemovalRequirementsChecklist, deriveRemovalReadiness } from "@/lib/certification/readiness";

function templateFacts(sources: LineSources = {}) {
  const template = structuredClone(fixture) as GhgEntryTemplate;
  const group = template.groups.find((item) => item.key === "pyrolysis")!;
  const component = group.components.find((item) => item.blueprint_key === "grid_electricity_use")!;
  group.components = ["one", "two"].map((id) => ({ ...structuredClone(component), id }));
  template.groups = [group];
  const definition = normalizeTemplateDefinition(template);
  const facts = {
    template, observation: { definition, lineSources: sources },
    enrichmentProblems: [], lineSourceProblems: validateLineSources(definition, sources),
    blueprintsForTemplate: [], unresolvedBlueprintKeys: [],
    unbindableTemplateInputs: findUnbindableTemplateInputs(template, { lineSources: sources }),
    requiredTransportCategories: [],
  };
  return { template, facility: { facilityTimezone: "UTC", templatesById: { [template.id]: facts } } as unknown as FacilityCertifierFacts };
}

function context(resolved: ReturnType<typeof resolveRemovalTemplate>): RemovalCertifyContext {
  return {
    ...resolved, mapping: {}, latestSubmission: null, hasOrgCredentials: true,
    memberBatches: [{ id: "batch", code: "CB-1", durabilityGateBlockers: [], facilityEmissionsGateBlockers: [] }],
    supportingDocuments: { total: 0, mirrored: 0 }, submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
    entityReadinessGaps: [], hasSubmittableRuns: true, requiredTransportCategories: [],
  } as unknown as RemovalCertifyContext;
}

it.each(["stale entry", "unit mismatch"] as const)("counts both undecided lines despite a %s on one, across both facts adapters", (problem) => {
  const { template, facility } = templateFacts();
  const entryFacts = {
    entries: [{ componentId: "one", observationId: "old", kind: "value", hasEvidence: true,
      counts: problem !== "stale entry", unitMismatch: problem === "unit mismatch",
      total: { magnitude: "1", unit: "kWh" } }],
    previousObservations: new Map(), automaticFigures: {},
  } as unknown as BatchEmissionContext[string];
  const resolved = resolveRemovalTemplate([
    { id: "batch", removalTemplateId: template.id },
    { id: "second-batch", removalTemplateId: template.id },
  ], facility, { batch: entryFacts });
  expect(resolved.undecidedLineIds).toEqual(["one", "two"]);
  expect(resolved.emissionLinesByBatchId.batch[0].blocker?.fixTarget).toBe("emissions");
  const ctx = context(resolved);
  const batch = toBatchHealthFacts(ctx, "batch");
  const removal = toRemovalReadinessFacts(ctx);
  expect(batch.undecidedLineIds).toBe(resolved.undecidedLineIds);
  expect(removal.undecidedLineIds).toBe(resolved.undecidedLineIds);
  for (const checks of [deriveBatchHealth(batch).checks, buildRemovalRequirementsChecklist(removal)]) {
    expect(checks.find((check) => check.key === "templateLines")).toMatchObject({
      status: "unmet", unmetLabel: "2 components to decide",
    });
  }
  expect(deriveRemovalReadiness(removal).state).toBe("blocked");
});

it("does not count decided lines merely because the template was not read in full", () => {
  const sources: LineSources = Object.fromEntries(["one", "two"].map((id) => [id, {
    scope: "operating" as const, origin: "reviewed" as const, entryPolicy: "none" as const,
  }]));
  const { template, facility } = templateFacts(sources);
  facility.templatesById[template.id]!.observation = null;
  const resolved = resolveRemovalTemplate([{ id: "batch", removalTemplateId: template.id }], facility);
  expect(resolved.undecidedLineIds).toEqual([]);
  const ctx = context(resolved);
  for (const checks of [
    deriveBatchHealth(toBatchHealthFacts(ctx, "batch")).checks,
    buildRemovalRequirementsChecklist(toRemovalReadinessFacts(ctx)),
  ]) {
    expect(checks.find((check) => check.key === "templateLines")?.unmetLabel).toBe("Template not fully read");
  }
});

it("counts proposed and contradictory contracts from the template decision", () => {
  const { template, facility } = templateFacts({
    one: { scope: "operating", automaticSource: "run-electricity", entryPolicy: "additive", origin: "proposed" },
    two: { scope: "operating", automaticSource: "run-electricity", entryPolicy: "additive", origin: "reviewed" },
  });
  expect(resolveRemovalTemplate([{ id: "batch", removalTemplateId: template.id }], facility).undecidedLineIds)
    .toEqual(["one", "two"]);
});

it("excludes removed components retained only to show stale entries", () => {
  const { template, facility } = templateFacts();
  const previous = normalizeTemplateDefinition(template);
  previous.groups[0].components = [{ ...previous.groups[0].components[0], id: "removed" }];
  const entryFacts = {
    entries: [{ componentId: "removed", observationId: "old", kind: "value", counts: false,
      hasEvidence: true, total: { magnitude: "1", unit: "kWh" } }],
    previousObservations: new Map([["old", { definition: previous }]]), automaticFigures: {},
  } as unknown as BatchEmissionContext[string];
  const resolved = resolveRemovalTemplate([{ id: "batch", removalTemplateId: template.id }], facility, { batch: entryFacts });
  expect(resolved.emissionLinesByBatchId.batch.map((line) => line.componentId)).toContain("removed");
  expect(resolved.undecidedLineIds).toEqual(["one", "two"]);
});
