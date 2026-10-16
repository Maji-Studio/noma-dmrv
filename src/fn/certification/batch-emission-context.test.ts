import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations";
import { loadBatchEmissionContext } from "./batch-emission-context";
import { resolveRemovalTemplate } from "./resolve-removal-template";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { deriveBatchHealth } from "@/lib/certification/batch-health";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import type { RemovalCertifyContext } from "./certify-context-types";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { loadBatchAutomaticFigures } from "@/data-access/batch-emission-automatic-figures";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { buildRemovalRequirementsChecklist, deriveRemovalReadiness } from "@/lib/certification/readiness";
import { resolveTemplateInputs } from "./removal-template-inputs";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";

vi.mock("@/data-access/emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
vi.mock("@/data-access/batch-emission-automatic-figures", () => ({ loadBatchAutomaticFigures: vi.fn(async () => ({})) }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn(() => true) }));
const template = {
  id: "template", display_name: "Template", groups: [{ id: "g", key: "pyrolysis", components: [{
    id: "line", display_name: "Lab electricity EU", blueprint_key: "grid_electricity_use",
    inputs: [{ input_key: "electricity_use", type: "monitored", quantity_kind: "energy" }],
  }] }],
} as unknown as NonNullable<FacilityCertifierFacts["defaultTemplate"]>;
const observation = { externalTemplateId: template.id, definition: normalizeTemplateDefinition(template),
  enrichment: { line: { electricity_use: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } } };
const facilityFacts = { templatesById: { template: { template, observation,
  lineSourceProblems: [], enrichmentProblems: [], blueprintsForTemplate: [], unresolvedBlueprintKeys: [],
  unbindableTemplateInputs: [], requiredTransportCategories: [],
} } } as unknown as FacilityCertifierFacts;
const value = { componentId: "line", kind: "value", counts: true, hasEvidence: true, total: { magnitude: "1", unit: "kWh" } };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(emissionsEntriesEnabled).mockReturnValue(true); });

it.each([false, true])("health uses stored entries for each batch (grouped=%s)", async (grouped) => {
  const batches = ["one", ...(grouped ? ["two"] : [])].map(id => ({ id, removalTemplateId: "template" }));
  vi.mocked(loadBatchEmissionEntryFacts).mockImplementation(async (_ctx, batchId) => ({
    entries: batchId === "one" ? [value] : [], previousObservations: new Map(),
  }) as never);
  const facts = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facilityFacts);
  const resolved = resolveRemovalTemplate(batches, facilityFacts, facts);
  expect(resolved.emissionLinesByBatchId.one[0].state).toBe("filled");
  if (grouped) expect(resolved.emissionLinesByBatchId.two[0].state).toBe("empty");
  expect(loadBatchEmissionEntryFacts).toHaveBeenCalledTimes(batches.length);
  const context = { ...resolved, memberBatches: batches, requiredTransportCategories: [] } as unknown as RemovalCertifyContext;
  expect(toBatchHealthFacts(context, "one").emissionLines?.[0].state).toBe("filled");
  if (grouped) expect(toBatchHealthFacts(context, "two").emissionLines?.[0].state).toBe("empty");
});
it("names missing-evidence lines, while an operator zero has no blocker", async () => {
  const batches = ["missing", "zero"].map(id => ({ id, removalTemplateId: "template" }));
  vi.mocked(loadBatchEmissionEntryFacts).mockImplementation(async (_ctx, id) => ({
    entries: [{ ...value, hasEvidence: false, ...(id === "zero" ? { kind: "zero", total: null, confirmedForRemovalId: null, note: "No lab work" } : {}) }], previousObservations: new Map(),
  }) as never);
  const loaded = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facilityFacts);
  const resolved = resolveRemovalTemplate(batches, facilityFacts, loaded);
  const context = { ...resolved, memberBatches: batches, requiredTransportCategories: [], mapping: {},
    hasSubmittableRuns: true, entityReadinessGaps: [], submissionLineageBlockers: [], durabilityConfigurationBlockers: [] } as unknown as RemovalCertifyContext;
  const checks = deriveBatchHealth(toBatchHealthFacts(context, "missing")).checks;
  expect(checks.find(check => check.key === "emissions")).toMatchObject({ status: "unmet", detail: "Add a file for Lab electricity EU." });
  expect(resolved.emissionLinesByBatchId.zero[0].state).toBe("confirmedZero");
  expect(resolved.emissionLinesByBatchId.zero[0].blocker).toBeUndefined();
});
it("uses batch-wide automatic figures instead of empty placeholders", async () => {
  const facts = structuredClone(facilityFacts);
  facts.templatesById.template!.observation!.lineSources.line.automaticSource = "run-electricity";
  vi.mocked(loadBatchEmissionEntryFacts).mockResolvedValue({ entries: [], previousObservations: new Map() });
  vi.mocked(loadBatchAutomaticFigures).mockResolvedValue({ "run-electricity": { magnitude: "3", unit: "kWh" } });
  const batches = [{ id: "one", removalTemplateId: "template" }];
  const loaded = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facts);
  expect(resolveRemovalTemplate(batches, facts, loaded).emissionLinesByBatchId.one[0]).toMatchObject({ state: "filled", total: { magnitude: "3", unit: "kWh" } });
});
it("does not query entries or automatic facts with the gate off", async () => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
  expect(await loadBatchEmissionContext(makeTestOrgContext(), "facility", [{ id: "one", removalTemplateId: "template" }], facilityFacts)).toEqual({});
  expect(loadBatchEmissionEntryFacts).not.toHaveBeenCalled();
  expect(loadBatchAutomaticFigures).not.toHaveBeenCalled();
});

it("keeps batch emissions unmet until a compatible changed entry is confirmed", async () => {
  const facts = structuredClone(facilityFacts);
  const current = { ...observation, lineSources: { line: { ...observation.lineSources.line, automaticSource: "run-electricity" as const } } };
  facts.templatesById.template!.observation = current as never;
  const previousObservations = new Map([["previous", observation], ["current", current]]);
  const stored = { componentId: "line", kind: "value", documentCount: 1, observationId: "previous",
    values: [{ inputKey: "electricity_use", magnitude: "1", unit: "kWh" }] };
  const entryFacts = () => deriveEmissionEntryFacts([stored] as never, current as never, previousObservations as never);
  expect(entryFacts()[0]).toMatchObject({ counts: false, canConfirm: true, reason: "Confirm this entry for the changed template line." });
  const batches = [{ id: "one", removalTemplateId: "template" }];
  vi.mocked(loadBatchEmissionEntryFacts).mockImplementation(async () => ({ entries: entryFacts(), previousObservations }) as never);
  const emissionsCheck = async () => {
    const loaded = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facts);
    const resolved = resolveRemovalTemplate(batches, facts, loaded);
    const context = { ...resolved, memberBatches: batches, requiredTransportCategories: [], mapping: {},
      hasSubmittableRuns: true, entityReadinessGaps: [], submissionLineageBlockers: [], durabilityConfigurationBlockers: [] } as unknown as RemovalCertifyContext;
    return deriveBatchHealth(toBatchHealthFacts(context, "one")).checks.find(check => check.key === "emissions");
  };
  expect(await emissionsCheck()).toMatchObject({ status: "unmet", detail: "Check the manual entry on Lab electricity EU." });
  stored.observationId = "current";
  expect(await emissionsCheck()).toMatchObject({ status: "met" });
});

it.each([false, true])("keeps removed-entry blockers in Removal readiness (grouped=%s)", async (grouped) => {
  const facts = structuredClone(facilityFacts);
  const live = facts.templatesById.template!;
  live.template.groups = [];
  live.observation = { ...live.observation!, definition: { groups: [] }, lineSources: {}, enrichment: {} };
  const batches = ["one", ...(grouped ? ["two"] : [])].map(id => ({ id, removalTemplateId: "template" }));
  vi.mocked(loadBatchEmissionEntryFacts).mockImplementation(async (_ctx, batchId) => ({
    entries: batchId === "one" ? [1, 2].map(() => ({ ...value, observationId: "previous", counts: false,
      reason: "Enter the values again for the current template line." })) : [],
    previousObservations: new Map([["previous", observation]]),
  }) as never);
  const loaded = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facts);
  const resolved = resolveRemovalTemplate(batches, facts, loaded);
  expect(resolved.emissionLines).toHaveLength(1);
  expect(resolved.emissionLinesByBatchId.one[0]).toMatchObject({ displayName: "Lab electricity EU", state: "needsReview",
    total: null, blocker: { code: "lineNeedsReview", fixTarget: "emissions" }, entries: [{ counts: false }, { counts: false }] });
  if (grouped) expect(resolved.emissionLinesByBatchId.two).toEqual([]);
  const readiness = { local: null, lockInFlight: false, hasMapping: true, hasOrgCredentials: true, hasRemovalTemplate: true,
    hasSubmittableRuns: true, requiredTransport: [], feedstockTypeMappingGaps: [], ...resolved,
    emissionLineBlockers: resolved.emissionLines!.flatMap(line => line.blocker ? [line.blocker] : []),
  };
  expect(deriveRemovalReadiness(readiness).state).toBe("blocked");
  expect(buildRemovalRequirementsChecklist(readiness).find(check => check.key === "template"))
    .toMatchObject({ status: "unmet", detail: "Enter the values again for the current template line." });
  // Retained review lines never become live compilation components.
  expect(resolveTemplateInputs({ template: resolved.removalTemplate!, lineSources: resolved.lineSources,
    emissionLines: resolved.emissionLines, blueprintsByKey: new Map(),
    agg: {} as Parameters<typeof resolveTemplateInputs>[0]["agg"], externalProjectId: "project",
    sourceIds: [], sourceBindingPlan: [], allowPeriodInputStub: true, omitProductionComponents: false,
  })).toMatchObject({ monitored: [], fixed: [], datapointBodyByKey: new Map() });
  expect(live.template.groups).toEqual([]);
  expect(live.observation.definition.groups).toEqual([]);
});
