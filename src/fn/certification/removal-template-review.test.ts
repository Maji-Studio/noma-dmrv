import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { getLatestTemplateObservation, reviewLineContracts } from "@/data-access/removal-template-observations";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { listPinnedRemovalTemplateIds } from "@/data-access/credit-batch-removal-template";
import { requireOrgFacility } from "@/data-access/utils";
import { listComponentBlueprints, listGhgEntryTemplates, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { observeRemovalTemplate, TEMPLATE_ENRICHMENT_TTL_MS } from "./observe-removal-template";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { enrichmentProblems, fullFingerprint, lineNeedsReview, lineSourcesForObservation, normalizeTemplateDefinition, resolveLineSources, semanticFingerprint, validateLineSources, type TemplateEnrichment } from "@/lib/isometric/template-observations";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { loadRemovalTemplateReview, loadRemovalTemplateReviewEntry } from "./removal-template-review";
import { canAcceptProposal, problemMessages } from "@/components/certification/removal-template-review-model";

const ctx = vi.hoisted((): OrgContext => ({ userId: "review-user", organizationId: "review-org", orgRole: "admin", isPlatformAdmin: false }));
vi.mock("../with-action", async () => {
  const { mockWithAction } = await import("../../../tests/helpers/mock-with-action");
  return mockWithAction(ctx);
});
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ reviewLineContracts: vi.fn(), getPreviousTemplateObservation: vi.fn(), getLatestTemplateObservation: vi.fn(async () => null) }));
vi.mock("@/lib/isometric/template-observations/load-enrichment", () => ({ loadTemplateEnrichment: vi.fn(async () => ({})) }));
vi.mock("./observe-removal-template", async (importOriginal) => ({
  ...await importOriginal<typeof import("./observe-removal-template")>(),
  observeRemovalTemplate: vi.fn(),
}));
vi.mock("@/data-access/credit-batch-removal-template", () => ({ listPinnedRemovalTemplateIds: vi.fn(async () => []) }));
vi.mock("@/data-access/certification", () => ({ getCertifierProjectByFacility: vi.fn() }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => ({})), hasCertifierCredentials: vi.fn(async () => true) }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
vi.mock("./removal-template-facts", () => ({ loadRemovalTemplateFacts: vi.fn() }));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  listGhgEntryTemplates: vi.fn(), listComponentBlueprints: vi.fn(async () => []),
}));
const id = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(null);
  vi.mocked(listPinnedRemovalTemplateIds).mockResolvedValue([]);
  vi.mocked(listComponentBlueprints).mockResolvedValue([]);
  ctx.orgRole = "admin";
  vi.mocked(loadTemplateEnrichment).mockResolvedValue({});
  vi.mocked(requireOrgFacility).mockResolvedValue(undefined as never);
  vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id } as never);
  vi.mocked(listGhgEntryTemplates).mockResolvedValue([fixture as IsometricGhgEntryTemplate]);
});

describe("project template listing", () => {
  it("lists unused templates as read-only without observing them, even without a default", async () => {
    const result = await loadRemovalTemplateReview(id);
    if (!result.success) throw new Error("expected a read");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ templateId: fixture.id, observation: null, preview: true, isCurrent: false, isPinned: false });
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(listComponentBlueprints).toHaveBeenCalledTimes(1);
  });

  it("matches an unused template's read-only entry, including line metadata", async () => {
    const listing = await loadRemovalTemplateReview(id);
    const entry = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id });
    if (!listing.success || !entry.success) throw new Error("expected reads");
    expect(listing.data[0]).toEqual(entry.data);
    expect(entry.data.lines[0]).toMatchObject({
      section: expect.any(String), groupPosition: expect.any(Number), blueprintType: null,
    });
    expect(observeRemovalTemplate).not.toHaveBeenCalled();
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(reviewLineContracts).not.toHaveBeenCalled();
  });

  it("orders default, pinned and remaining Removal templates and preserves missing references", async () => {
    const template = { ...fixture, groups: [] } as IsometricGhgEntryTemplate;
    const make = (templateId: string) => ({ ...template, id: templateId });
    vi.mocked(listGhgEntryTemplates).mockResolvedValue([
      make("unused-a"), make("stored"), make("pinned"), make("default"), make("unused-b"),
      { ...make("reduction"), credit_type: "REDUCTION" },
    ]);
    vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: "default" } as never);
    vi.mocked(listPinnedRemovalTemplateIds).mockResolvedValue(["pinned", "missing-pin"]);
    vi.mocked(getLatestTemplateObservation).mockImplementation(async (_ctx, _provider, templateId) =>
      templateId === "stored" ? { id: "observation", definition: { groups: [] }, lineSources: {}, enrichment: {} } as never : null);
    vi.mocked(loadRemovalTemplateFacts).mockImplementation(async (_ctx, input) => ({
      template: input.template, observation: null, blueprintsForTemplate: [], enrichmentProblems: [], lineSourceProblems: [],
    }) as never);
    const result = await loadRemovalTemplateReview(id);
    if (!result.success) throw new Error("expected a read");
    expect(result.data.map((entry) => entry.templateId)).toEqual(["default", "pinned", "missing-pin", "unused-a", "stored", "unused-b"]);
    expect(result.data.find((entry) => entry.templateId === "missing-pin")).toMatchObject({ availability: "missing", isPinned: true, lines: [] });
    expect(vi.mocked(loadRemovalTemplateFacts).mock.calls.map(([, input]) => input.template.id)).toEqual(["default", "pinned", "stored"]);
    expect(result.data.filter((entry) => entry.preview).map((entry) => entry.templateId)).toEqual(["unused-a", "unused-b"]);
    expect(listComponentBlueprints).toHaveBeenCalledTimes(1);
  });

  it("retains a missing default before the available templates", async () => {
    vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: "gone" } as never);
    const result = await loadRemovalTemplateReview(id);
    if (!result.success) throw new Error("expected a read");
    expect(result.data[0]).toMatchObject({ templateId: "gone", availability: "missing", isCurrent: true, isPinned: false });
    expect(result.data[1]).toMatchObject({ templateId: fixture.id, preview: true });
  });
});

it("lets a member read an unpinned target in their facility's registry project", async () => {
  ctx.orgRole = "member";
  const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
  const lineSources = resolveLineSources({ definition });
  const componentId = "rtc_1KWHFRM4GSBX5Y7A";
  lineSources[componentId].origin = "proposed";
  // Keep one pending line and surface real validation problems from the live read.
  lineSources[componentId].scope = "unassigned";
  lineSources[componentId].entryPolicy = "none";
  delete lineSources[componentId].automaticSource;
  const latest = { definition, lineSources, enrichedAt: new Date(0), semanticFingerprint: semanticFingerprint(definition, {}), fullFingerprint: fullFingerprint(definition, {}) };
  vi.mocked(getLatestTemplateObservation).mockResolvedValueOnce(latest as never);
  const expectedSources = lineSourcesForObservation({ definition, enrichment: {}, latest });
  const problems = validateLineSources(definition, expectedSources);
  const result = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id });
  expect(result).toMatchObject({ success: true, data: {
    templateId: fixture.id, enrichmentProblems: enrichmentProblems(definition, {}), lineSourceProblems: problems,
  } });
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  expect(observeRemovalTemplate).not.toHaveBeenCalled();
  if (!result.success) throw new Error("expected a read");
  expect(result.data.lines.filter((line) => lineNeedsReview(line.component.id, line.contract, result.data.lineSourceProblems))).toHaveLength(1);
  expect(loadTemplateEnrichment).toHaveBeenCalledWith({}, fixture, []);
  expect(requireOrgFacility).toHaveBeenCalledWith(ctx, id);
  expect(getCertifierProjectByFacility).toHaveBeenCalledWith(ctx, id, "isometric");
  expect(listGhgEntryTemplates).toHaveBeenCalledWith({}, fixture.project_id);
});

it("refuses a cross-org facility before reading registry facts", async () => {
  vi.mocked(requireOrgFacility).mockRejectedValueOnce(new Error("Facility not found"));
  expect((await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id })).success).toBe(false);
  expect(listGhgEntryTemplates).not.toHaveBeenCalled();
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
});

it("refuses an entry target absent from the facility project", async () => {
  expect((await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: "other-project-template" })).success).toBe(false);
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
});

describe("loadRemovalTemplateReviewEntry", () => {
  it("drops stored colliding proposals for an unchanged template without writing", async () => {
    const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
    const lineSources = resolveLineSources({ definition });
    const ids = ["rtc_1KWHFRM4GSBX5Y7A", "rtc_1KWP4Y13JSBXV8FB"];
    for (const componentId of ids) {
      lineSources[componentId] = { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "proposed" };
    }
    const before = structuredClone(lineSources);
    vi.mocked(getLatestTemplateObservation).mockResolvedValueOnce({ definition, lineSources, enrichedAt: new Date(0), semanticFingerprint: semanticFingerprint(definition, {}), fullFingerprint: fullFingerprint(definition, {}) } as never);
    const result = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id });
    if (!result.success) throw new Error("expected a read");
    for (const componentId of ids) {
      expect(result.data.lines.find((line) => line.component.id === componentId)?.contract)
        .toEqual({ scope: "unassigned", entryPolicy: "none", origin: "proposed" });
    }
    expect(lineSources).toEqual(before);
    expect(observeRemovalTemplate).not.toHaveBeenCalled();
    expect(reviewLineContracts).not.toHaveBeenCalled();
  });

  it("keeps a sample shipping proposal's scope and entry policy once its source is retired", async () => {
    const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
    const lineSources = resolveLineSources({ definition });
    const componentId = "rtc_1M4ZRPH1RSBXADG2";
    lineSources[componentId] = { scope: "operating", automaticSource: "sample-transport", entryPolicy: "additive", origin: "proposed" };
    vi.mocked(getLatestTemplateObservation).mockResolvedValueOnce({ definition, lineSources, enrichedAt: new Date(),
      semanticFingerprint: semanticFingerprint(definition, {}), fullFingerprint: fullFingerprint(definition, {}) } as never);
    const result = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id });
    if (!result.success) throw new Error("expected a read");
    expect(result.data.lines.find((line) => line.component.id === componentId)?.contract)
      .toEqual({ scope: "operating", automaticSource: undefined, entryPolicy: "additive", origin: "proposed" });
  });

  it("shows a template no batch uses yet, proposals included, without observing it", async () => {
    const result = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id });
    if (!result.success) throw new Error("expected a read");
    expect(result.data).toMatchObject({ templateId: fixture.id, observation: null, preview: true, availability: "listed" });
    expect(result.data.lines.length).toBeGreaterThan(0);
    expect(result.data.enrichment).toEqual({});
    expect(observeRemovalTemplate).not.toHaveBeenCalled();
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(requireOrgFacility).toHaveBeenCalledWith(ctx, id);
  });

  it("refuses a cross-org facility and a template the project does not list", async () => {
    vi.mocked(requireOrgFacility).mockRejectedValueOnce(new Error("Facility not found"));
    expect((await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id })).success).toBe(false);
    expect(listGhgEntryTemplates).not.toHaveBeenCalled();
    expect((await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: "other-project-template" })).success).toBe(false);
  });
});

it("sends retired-source contracts and candidates for client proposal validation", async () => {
  const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
  const lineSources = resolveLineSources({ definition });
  const ids = ["rtc_1M4ZRPH1RSBXADG2", "rtc_1M4ZRRN6PSBXHQ7C"];
  for (const componentId of ids) {
    lineSources[componentId] = { scope: "operating", automaticSource: "sample-transport", entryPolicy: "additive", origin: "proposed" };
  }
  const before = structuredClone(lineSources);
  const observation = { id, definition, lineSources };
  vi.mocked(listPinnedRemovalTemplateIds).mockResolvedValue([fixture.id]);
  vi.mocked(loadRemovalTemplateFacts).mockResolvedValueOnce({
    template: fixture, observation, blueprintsForTemplate: [], enrichmentProblems: [], lineSourceProblems: validateLineSources(definition, lineSources),
  } as never);
  const result = await loadRemovalTemplateReview(id);
  if (!result.success) throw new Error("expected a read");
  const entry = result.data[0];
  expect(entry.observation?.id).toBe(id);
  expect(lineSources).toEqual(before);
  expect(Object.values(entry.observation!.lineSources).some((contract) => contract.automaticSource === "sample-transport")).toBe(false);
  for (const componentId of ids) {
    const line = entry.lines.find((candidate) => candidate.component.id === componentId)!;
    expect(line.contract).toEqual(entry.observation?.lineSources[componentId]);
    expect(line.contract).toMatchObject({ scope: "operating", entryPolicy: "additive", origin: "proposed" });
    expect(line.contract.automaticSource).toBe(undefined);
    expect(line.catalogCandidates.includes("sample-transport")).toBe(false);
    expect(canAcceptProposal(entry, line, {})).toBe(true);
  }
});

it("preserves the server's retired-source review problem and operator guidance after stripping the source", async () => {
  const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
  const lineSources = resolveLineSources({ definition });
  const componentId = "rtc_1M4ZRPH1RSBXADG2";
  lineSources[componentId] = { scope: "operating", automaticSource: "sample-transport", entryPolicy: "none", origin: "reviewed" };
  vi.mocked(listPinnedRemovalTemplateIds).mockResolvedValue([fixture.id]);
  vi.mocked(loadRemovalTemplateFacts).mockResolvedValueOnce({
    template: fixture, observation: { id, definition, lineSources }, blueprintsForTemplate: [], enrichmentProblems: [], lineSourceProblems: validateLineSources(definition, lineSources),
  } as never);
  const result = await loadRemovalTemplateReview(id);
  if (!result.success) throw new Error("expected a read");
  const entry = result.data[0];
  const line = entry.lines.find((candidate) => candidate.component.id === componentId)!;
  expect(line.contract.automaticSource).toBeUndefined();
  expect(problemMessages(line, entry.lineSourceProblems)).toEqual([
    "These automatic datapoints are no longer available. Choose others or allow entries for this component.",
  ]);
});

it("recomputes entry contracts when live enrichment differs from the stored read", async () => {
  const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
  const lineSources = resolveLineSources({ definition });
  const latest = { definition, lineSources, enrichedAt: new Date(0), semanticFingerprint: semanticFingerprint(definition, {}), fullFingerprint: fullFingerprint(definition, {}) };
  const component = definition.groups.flatMap((group) => group.components).find((component) => component.inputs.length)!;
  const enrichment = { [component.id]: { [component.inputs[0].key]: { unit: "changed-unit" } } };
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(latest as never);
  vi.mocked(loadTemplateEnrichment).mockResolvedValue(enrichment);
  const entry = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id });
  if (!entry.success) throw new Error("expected preview reads");
  expect(entry.data).toMatchObject({
    templateId: fixture.id,
    enrichmentProblems: enrichmentProblems(definition, enrichment),
    lineSourceProblems: validateLineSources(definition, lineSourcesForObservation({ definition, enrichment, latest })),
  });
  expect(entry.data.lines.find((line) => line.contract.origin === "carried")).toBeDefined();
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  expect(observeRemovalTemplate).not.toHaveBeenCalled();
});

describe("read-only entry enrichment reuse", () => {
  const template = structuredClone(fixture) as IsometricGhgEntryTemplate;
  const group = template.groups.find((group) => group.key === "pyrolysis")!;
  const component = group.components.find((component) => component.blueprint_key === "grid_electricity_use")!;
  group.components = [component];
  template.groups = [group];
  const definition = normalizeTemplateDefinition(template);
  const storedEnrichment: TemplateEnrichment = { [component.id]: {
    electricity_use: { unit: "kWh" },
    grid_carbon_intensity: { unit: "kgCO2e / kWh", fixedValue: "0.5" },
  } };
  const liveEnrichment: TemplateEnrichment = { [component.id]: {
    electricity_use: { unit: "MWh" },
    grid_carbon_intensity: { status: "unknown" },
  } };
  const lineSources = { [component.id]: { scope: "unassigned", entryPolicy: "none", origin: "proposed" } } as const;
  function storedObservation(ageMs: number) {
    return {
      definition, enrichment: storedEnrichment, lineSources, externalProjectId: template.project_id,
      enrichedAt: new Date(Date.now() - ageMs),
      semanticFingerprint: semanticFingerprint(definition, storedEnrichment),
      fullFingerprint: fullFingerprint(definition, storedEnrichment),
    };
  }

  beforeEach(() => {
    vi.mocked(listGhgEntryTemplates).mockResolvedValue([template]);
    vi.mocked(loadTemplateEnrichment).mockResolvedValue(liveEnrichment);
  });

  it("uses fresh complete stored enrichment while retaining blueprint metadata without writing", async () => {
    const latest = storedObservation(0);
    const before = structuredClone(latest);
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(latest as never);
    const input = { facilityId: id, removalTemplateId: template.id };
    const entry = await loadRemovalTemplateReviewEntry(input);
    expect(entry).toMatchObject({ success: true, data: {
      observation: null, preview: true, enrichment: storedEnrichment, enrichmentProblems: [],
      lineSourceProblems: [{ code: "unassigned", componentId: component.id }],
    } });
    expect(enrichmentProblems(definition, liveEnrichment)).toEqual([
      { code: "unknown-enrichment", componentId: component.id, inputKey: "grid_carbon_intensity" },
    ]);
    expect(loadTemplateEnrichment).not.toHaveBeenCalled();
    expect(listComponentBlueprints).toHaveBeenCalledExactlyOnceWith({});
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(observeRemovalTemplate).not.toHaveBeenCalled();
    expect(reviewLineContracts).not.toHaveBeenCalled();
    expect(latest).toEqual(before);
  });

  it("loads live enrichment for a stored observation older than the TTL", async () => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(storedObservation(TEMPLATE_ENRICHMENT_TTL_MS + 1) as never);
    const result = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: template.id });
    expect(result).toMatchObject({ success: true, data: {
      templateId: template.id,
      enrichmentProblems: [{ code: "unknown-enrichment", componentId: component.id, inputKey: "grid_carbon_intensity" }],
      lineSourceProblems: [],
    } });
    expect(listComponentBlueprints).toHaveBeenCalledExactlyOnceWith({});
    expect(loadTemplateEnrichment).toHaveBeenCalledExactlyOnceWith({}, template, []);
    expect(vi.mocked(getLatestTemplateObservation).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(listComponentBlueprints).mock.invocationCallOrder[0]);
    expect(observeRemovalTemplate).not.toHaveBeenCalled();
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  });
});
