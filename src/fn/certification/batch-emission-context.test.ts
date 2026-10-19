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
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { listEmissionEntries, listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getTemplateObservationById, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { requireOrgFacility } from "@/data-access/utils";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { buildRemovalRequirementsChecklist, deriveRemovalReadiness } from "@/lib/certification/readiness";
import { resolveTemplateInputs } from "./removal-template-inputs";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";

vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntries: vi.fn(), listEmissionEntriesForBatches: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ getTemplateObservationById: vi.fn(), getTemplateObservationsByIds: vi.fn() }));
vi.mock("@/data-access/batch-emission-automatic-figures", () => ({ loadBatchesEmissionAutomaticFacts: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgScope: vi.fn(), requireOrgFacility: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn(() => true) }));
const template = {
  id: "template", display_name: "Template", groups: [{ id: "g", key: "pyrolysis", components: [{
    id: "line", display_name: "Lab electricity EU", blueprint_key: "grid_electricity_use",
    inputs: [{ input_key: "electricity_use", type: "monitored", quantity_kind: "energy" }],
  }] }],
} as unknown as NonNullable<FacilityCertifierFacts["defaultTemplate"]>;
const observation = { id: "current", externalTemplateId: template.id, definition: normalizeTemplateDefinition(template),
  enrichment: { line: { electricity_use: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } } };
const facilityFacts = { templatesById: { template: { template, observation,
  lineSourceProblems: [], enrichmentProblems: [], blueprintsForTemplate: [], unresolvedBlueprintKeys: [],
  unbindableTemplateInputs: [], requiredTransportCategories: [],
} } } as unknown as FacilityCertifierFacts;
type StoredEntry = Awaited<ReturnType<typeof listEmissionEntriesForBatches>>[number];
function storedEntry(creditBatchId: string, overrides: Partial<StoredEntry> = {}): StoredEntry {
  return { creditBatchId, componentId: "line", kind: "value", documentCount: 1, observationId: "current",
    values: [{ inputKey: "electricity_use", magnitude: "1", unit: "kWh" }], ...overrides } as StoredEntry;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(true);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([]);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([]);
  vi.mocked(loadCreditBatchRollups).mockImplementation(async (_ctx, ids) => Object.fromEntries(
    ids.map(id => [id, { batch: { facilityId: "facility" } }]),
  ) as never);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockImplementation(async (_ctx, ids) => Object.fromEntries(
    ids.map(id => [id, { automaticFigures: {} }]),
  ));
});

it("loads three batches once per bulk loader and matches the per-batch entry facts", async () => {
  const ctx = makeTestOrgContext();
  const facts = structuredClone(facilityFacts);
  const other = { ...observation, id: "other-current", externalTemplateId: "other-template" };
  facts.templatesById["other-template"] = { ...facts.templatesById.template!, observation: other as never };
  const batches = [
    { id: "one", removalTemplateId: "template" },
    { id: "two", removalTemplateId: "other-template" },
    { id: "three", removalTemplateId: "template" },
  ];
  const previous = { ...observation, id: "previous" };
  const observations = [observation, other, previous];
  const stored = [
    storedEntry("one", { observationId: "previous" }),
    storedEntry("two", { observationId: "other-current", documentCount: 0 }),
    storedEntry("one"),
    storedEntry("two", { observationId: "previous" }),
    storedEntry("three", { observationId: "missing" }),
  ];
  const automatic = {
    one: { automaticFigures: { "run-electricity": { magnitude: "3", unit: "kWh" } } },
    two: { automaticFigures: { "run-electricity": { magnitude: "7", unit: "kWh" } } },
    three: { automaticFigures: { "delivery-transport": null } },
  } satisfies Awaited<ReturnType<typeof loadBatchesEmissionAutomaticFacts>>;
  vi.mocked(listEmissionEntries).mockImplementation(async (_ctx, id) => stored.filter(entry => entry.creditBatchId === id));
  vi.mocked(getTemplateObservationById).mockImplementation(async (_ctx, id) =>
    (observations.find(item => item.id === id) ?? null) as never,
  );
  const expected = Object.fromEntries(await Promise.all(batches.map(async (batch) => [batch.id, {
    ...await loadBatchEmissionEntryFacts(ctx, batch.id, facts.templatesById[batch.removalTemplateId]!.observation!),
    automaticFigures: automatic[batch.id as keyof typeof automatic].automaticFigures,
  }])));
  vi.clearAllMocks();
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue(stored);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([previous] as never);
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue(automatic);

  const result = await loadBatchEmissionContext(ctx, "facility", batches, facts);

  expect(result).toEqual(expected);
  const ids = batches.map(batch => batch.id);
  expect(listEmissionEntriesForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ids);
  expect(getTemplateObservationsByIds).toHaveBeenCalledExactlyOnceWith(ctx, ["previous", "missing"]);
  expect(loadBatchesEmissionAutomaticFacts).toHaveBeenCalledExactlyOnceWith(ctx, ids);
  expect(loadCreditBatchRollups).toHaveBeenCalledExactlyOnceWith(ctx, ids);
  expect(requireOrgFacility).toHaveBeenCalledExactlyOnceWith(ctx, "facility");
  expect(listEmissionEntries).not.toHaveBeenCalled();
  expect(getTemplateObservationById).not.toHaveBeenCalled();
  expect(result.one.previousObservations.has("other-current")).toBe(false);
  expect(result.three.previousObservations.get("missing")).toBeNull();
});

it("only loads batches with a readable observation, including batches without entries", async () => {
  const ctx = makeTestOrgContext();
  const batches = [
    { id: "readable", removalTemplateId: "template" },
    { id: "unpinned", removalTemplateId: null },
    { id: "unreadable", removalTemplateId: "missing-template" },
  ];
  expect(await loadBatchEmissionContext(ctx, "facility", batches, facilityFacts)).toEqual({
    readable: { entries: [], previousObservations: new Map(), automaticFigures: {} },
  });
  expect(listEmissionEntriesForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["readable"]);
  expect(loadBatchesEmissionAutomaticFacts).toHaveBeenCalledExactlyOnceWith(ctx, ["readable"]);
  expect(loadCreditBatchRollups).toHaveBeenCalledExactlyOnceWith(ctx, ["readable"]);
  vi.clearAllMocks();
  expect(await loadBatchEmissionContext(ctx, "facility", batches.slice(1), facilityFacts)).toEqual({});
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
  expect(getTemplateObservationsByIds).not.toHaveBeenCalled();
  expect(loadBatchesEmissionAutomaticFacts).not.toHaveBeenCalled();
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
  expect(requireOrgFacility).not.toHaveBeenCalled();
});

it.each(["other-facility", null])("rejects a foreign or missing batch before loading emissions (%s)", async (facilityId) => {
  vi.mocked(loadCreditBatchRollups).mockResolvedValue(facilityId
    ? { one: { batch: { facilityId } } } as never : {});
  await expect(loadBatchEmissionContext(makeTestOrgContext(), "facility", [
    { id: "one", removalTemplateId: "template" },
  ], facilityFacts)).rejects.toThrow("Credit batch was not found.");
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
  expect(getTemplateObservationsByIds).not.toHaveBeenCalled();
  expect(loadBatchesEmissionAutomaticFacts).not.toHaveBeenCalled();
});

it("keeps the organization/facility guard before loading batch facts", async () => {
  vi.mocked(requireOrgFacility).mockRejectedValue(new Error("Facility not found in this organization"));
  await expect(loadBatchEmissionContext(makeTestOrgContext(), "facility", [
    { id: "one", removalTemplateId: "template" },
  ], facilityFacts)).rejects.toThrow("Facility not found in this organization");
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
  expect(loadBatchesEmissionAutomaticFacts).not.toHaveBeenCalled();
});

it.each([false, true])("health uses stored entries for each batch (grouped=%s)", async (grouped) => {
  const batches = ["one", ...(grouped ? ["two"] : [])].map(id => ({ id, removalTemplateId: "template" }));
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([storedEntry("one")]);
  const facts = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facilityFacts);
  const resolved = resolveRemovalTemplate(batches, facilityFacts, facts);
  expect(resolved.emissionLinesByBatchId.one[0].state).toBe("filled");
  if (grouped) expect(resolved.emissionLinesByBatchId.two[0].state).toBe("empty");
  expect(listEmissionEntriesForBatches).toHaveBeenCalledTimes(1);
  const context = { ...resolved, memberBatches: batches, requiredTransportCategories: [] } as unknown as RemovalCertifyContext;
  expect(toBatchHealthFacts(context, "one").emissionLines?.[0].state).toBe("filled");
  if (grouped) expect(toBatchHealthFacts(context, "two").emissionLines?.[0].state).toBe("empty");
});
it("names missing-evidence lines, while a Removal-owned zero keeps its source blocker", async () => {
  const batches = ["missing", "zero"].map(id => ({ id, removalTemplateId: "template" }));
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([
    storedEntry("missing", { documentCount: 0 }),
    storedEntry("zero", { documentCount: 0, kind: "zero", values: [], confirmedForRemovalId: "removal" }),
  ]);
  const loaded = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facilityFacts);
  const resolved = resolveRemovalTemplate(batches, facilityFacts, loaded);
  const context = { ...resolved, memberBatches: batches, requiredTransportCategories: [], mapping: {},
    hasSubmittableRuns: true, entityReadinessGaps: [], submissionLineageBlockers: [], durabilityConfigurationBlockers: [] } as unknown as RemovalCertifyContext;
  const checks = deriveBatchHealth(toBatchHealthFacts(context, "missing")).checks;
  expect(checks.find(check => check.key === "emissions")).toMatchObject({ status: "unmet", detail: "Add a file for Lab electricity EU." });
  expect(resolved.emissionLinesByBatchId.zero[0].state).toBe("confirmedZero");
  expect(resolved.emissionLinesByBatchId.zero[0].blocker).toMatchObject({ code: "lineHasNoSource" });
});
it("uses batch-wide automatic figures instead of empty placeholders", async () => {
  const facts = structuredClone(facilityFacts);
  facts.templatesById.template!.observation!.lineSources.line.automaticSource = "run-electricity";
  vi.mocked(loadBatchesEmissionAutomaticFacts).mockResolvedValue({ one: { automaticFigures: { "run-electricity": { magnitude: "3", unit: "kWh" } } } });
  const batches = [{ id: "one", removalTemplateId: "template" }];
  const loaded = await loadBatchEmissionContext(makeTestOrgContext(), "facility", batches, facts);
  expect(resolveRemovalTemplate(batches, facts, loaded).emissionLinesByBatchId.one[0]).toMatchObject({ state: "filled", total: { magnitude: "3", unit: "kWh" } });
});
it("does not query entries or automatic facts with the gate off", async () => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
  expect(await loadBatchEmissionContext(makeTestOrgContext(), "facility", [{ id: "one", removalTemplateId: "template" }], facilityFacts)).toEqual({});
  expect(listEmissionEntriesForBatches).not.toHaveBeenCalled();
  expect(getTemplateObservationsByIds).not.toHaveBeenCalled();
  expect(loadBatchesEmissionAutomaticFacts).not.toHaveBeenCalled();
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
  expect(requireOrgFacility).not.toHaveBeenCalled();
});

it("keeps batch emissions unmet until a compatible changed entry is confirmed", async () => {
  const facts = structuredClone(facilityFacts);
  const current = { ...observation, lineSources: { line: { ...observation.lineSources.line, automaticSource: "run-electricity" as const } } };
  facts.templatesById.template!.observation = current as never;
  const previousObservations = new Map([["previous", observation], ["current", current]]);
  const stored = storedEntry("one", { observationId: "previous" });
  const entryFacts = () => deriveEmissionEntryFacts([stored] as never, current as never, previousObservations as never);
  expect(entryFacts()[0]).toMatchObject({ counts: false, canConfirm: true, reason: "Confirm this entry for the changed template line." });
  const batches = [{ id: "one", removalTemplateId: "template" }];
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([stored]);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([{ ...observation, id: "previous" }] as never);
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
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([
    storedEntry("one", { observationId: "previous" }), storedEntry("one", { observationId: "previous" }),
  ]);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([{ ...observation, id: "previous" }] as never);
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
