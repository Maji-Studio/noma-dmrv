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
import { removalTemplateVerdict } from "@/lib/certification/removal-template-verdict";
import { removalTemplateReviewEntry } from "@/lib/certification/removal-template-review-entry";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { templateReadiness } from "@/components/certification/removal-template-review-model";
import { DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR, UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";
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

const decidedSources: LineSources = Object.fromEntries(["one", "two"].map((id) => [id, {
  scope: "operating", origin: "reviewed", entryPolicy: "none",
}]));

it.each([
  { shape: "fixed input without datapoint", code: "missingFixedDatapoint", key: "templateSet" },
  { shape: "components to decide", code: "templateLinesNeedReview", key: "templateLines" },
] as const)("agrees across the switch dialog, batch health and verdict for $shape", ({ code, key }) => {
  const { template, facility } = templateFacts(code === "missingFixedDatapoint" ? decidedSources : {});
  if (code === "missingFixedDatapoint") {
    template.groups[0].components[0].inputs.find((input) => input.type === "fixed")!.datapoint_id = null;
  }
  const facts = facility.templatesById[template.id]!;
  const entry = removalTemplateReviewEntry({
    templateId: template.id, ...facts, definition: normalizeTemplateDefinition(template),
  });
  const verdict = removalTemplateVerdict(entry);
  expect(verdict.blocker).toBe(code);
  expect(facts.lineSourceProblems.length > 0).toBe(verdict.toDecideCount > 0);
  const resolved = resolveRemovalTemplate([{ id: "batch", removalTemplateId: template.id }], facility);
  expect(resolved.templateBlockers).toEqual([{ code, message: REMOVAL_TEMPLATE_BLOCKERS[code] }]);
  const switchReadiness = templateReadiness({ ...entry, isCurrent: false, isPinned: true });
  expect(switchReadiness).toEqual(code === "missingFixedDatapoint"
    ? { ready: false, reason: REMOVAL_TEMPLATE_BLOCKERS[code] }
    : { ready: false, reason: "2 components to decide", toDecide: verdict.toDecideCount });
  const health = deriveBatchHealth(toBatchHealthFacts(context(resolved), "batch"));
  const check = health.checks.find((check) => check.key === key)!;
  expect(check).toMatchObject({
    status: "unmet", detail: REMOVAL_TEMPLATE_BLOCKERS[code],
    fixTarget: code === "missingFixedDatapoint" ? "templateSetup" : "templateLineReview",
  });
  if (code === "missingFixedDatapoint") expect(check.detail).toBe(switchReadiness.reason);
  else expect(check.unmetLabel).toBe(switchReadiness.reason);
});

it("keeps every batch blocker in the original order", () => {
  const { template, facility } = templateFacts();
  template.groups[0].components[0].inputs.find((input) => input.type === "fixed")!.datapoint_id = null;
  facility.templatesById[template.id]!.observation = null;
  const resolved = resolveRemovalTemplate([{ removalTemplateId: template.id }], facility);
  expect(resolved.templateBlockers).toEqual([
    { code: "templateNotFullyRead", message: REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead },
    { code: "missingFixedDatapoint", message: REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint },
    { code: "templateLinesNeedReview", message: REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview },
  ]);
});

it.each([DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR, UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR])(
  "keeps an existing %s pin's batch health while refusing selection", (blueprintKey) => {
    const { template, facility } = templateFacts(decidedSources);
    template.groups[0].components[0].blueprint_key = blueprintKey;
    const entry = removalTemplateReviewEntry({ templateId: template.id, ...facility.templatesById[template.id]! });
    expect(removalTemplateVerdict(entry).blocker).toBe("unsupportedSequestration");
    expect(templateReadiness({ ...entry, isCurrent: false, isPinned: true })).toEqual({
      ready: false, reason: REMOVAL_TEMPLATE_BLOCKERS.unsupportedSequestration,
    });
    expect(resolveRemovalTemplate([{ removalTemplateId: template.id }], facility).templateBlockers).toEqual([]);
  },
);

it("preserves the batch facts rule when a caller supplies no source problems", () => {
  const { template, facility } = templateFacts();
  const facts = facility.templatesById[template.id]!;
  facts.lineSourceProblems = [];
  const entry = removalTemplateReviewEntry({ templateId: template.id, ...facts });
  expect(removalTemplateVerdict(entry).toDecideCount).toBe(2);
  expect(resolveRemovalTemplate([{ removalTemplateId: template.id }], facility).templateBlockers).toEqual([]);
});

it("builds setup readiness from preview sources while retaining the matching observation", () => {
  const { template, facility } = templateFacts(decidedSources);
  const facts = facility.templatesById[template.id]!;
  const definition = normalizeTemplateDefinition(template);
  const entry = removalTemplateReviewEntry({
    templateId: template.id, ...facts, definition, lineSources: {},
    lineSourceProblems: validateLineSources(definition, {}),
  });
  expect(entry.observation?.lineSources).toEqual(decidedSources);
  expect(entry.lines.every((line) => line.contract.scope === "unassigned")).toBe(true);
  expect(removalTemplateVerdict(entry).toDecideCount).toBe(2);
});
