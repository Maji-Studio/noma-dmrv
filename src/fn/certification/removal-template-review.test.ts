import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { switchCreditBatchRemovalTemplate as switchTemplate } from "@/data-access/credit-batch-removal-template";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getLatestTemplateObservation, reviewLineContracts } from "@/data-access/removal-template-observations";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { requireOrgFacility } from "@/data-access/utils";
import { listComponentBlueprints, listGhgEntryTemplates, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { observeRemovalTemplate, TEMPLATE_ENRICHMENT_TTL_MS } from "./observe-removal-template";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { enrichmentProblems, fullFingerprint, lineNeedsReview, lineSourcesForObservation, normalizeTemplateDefinition, resolveLineSources, semanticFingerprint, validateLineSources, type TemplateEnrichment } from "@/lib/isometric/template-observations";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import { loadRemovalTemplateReviewEntry, loadRemovalTemplateReviewPreview, reviewRemovalTemplateLines, switchCreditBatchRemovalTemplate } from "./removal-template-review";

const ctx = vi.hoisted((): OrgContext => ({ userId: "review-user", organizationId: "review-org", orgRole: "owner", isPlatformAdmin: false }));
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
vi.mock("@/data-access/credit-batch-removal-template", () => ({ switchCreditBatchRemovalTemplate: vi.fn(), listPinnedRemovalTemplateIds: vi.fn() }));
vi.mock("@/data-access/certification", () => ({ getCertifierProjectByFacility: vi.fn() }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => ({})) }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
vi.mock("./removal-template-facts", () => ({ loadRemovalTemplateFacts: vi.fn() }));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  listGhgEntryTemplates: vi.fn(), listComponentBlueprints: vi.fn(async () => []),
}));
const id = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  ctx.orgRole = "owner";
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(null);
  vi.mocked(loadTemplateEnrichment).mockResolvedValue({});
  vi.mocked(requireOrgFacility).mockResolvedValue(undefined as never);
  vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id } as never);
  vi.mocked(listGhgEntryTemplates).mockResolvedValue([fixture as IsometricGhgEntryTemplate]);
});
describe("Removal template action guards", () => {
  it("denies members before review or switch reads", async () => {
    ctx.orgRole = "member";
    expect((await reviewRemovalTemplateLines({ observationId: id, expectedVersion: 1, assignments: {} })).success).toBe(false);
    expect((await switchCreditBatchRemovalTemplate({ creditBatchId: id, removalTemplateId: "rvt-1", expectedVersion: 1 })).success).toBe(false);
    expect(reviewLineContracts).not.toHaveBeenCalled();
    expect(getCreditBatchById).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"] as const)("permits %s reviews with server-resolved scope", async (role) => {
    ctx.orgRole = role;
    vi.mocked(reviewLineContracts).mockResolvedValue({ id } as never);
    const input = { observationId: id, expectedVersion: 1, assignments: {} };
    expect(await reviewRemovalTemplateLines(input)).toEqual({ success: true, data: { id } });
    expect(reviewLineContracts).toHaveBeenCalledWith(ctx, input);
  });
  it("validates contracts and versions before persistence", async () => {
    expect((await reviewRemovalTemplateLines({ observationId: id, expectedVersion: 0, assignments: {} })).success).toBe(false);
    expect((await reviewRemovalTemplateLines({ observationId: id, expectedVersion: 1, assignments: { line: { scope: "operating", automaticSource: "invented" as never, entryPolicy: "additive" } } })).success).toBe(false);
    expect(reviewLineContracts).not.toHaveBeenCalled();
  });
});

it("uses the accurate non-Removal refusal for Switch template", async () => {
  vi.mocked(getCreditBatchById).mockResolvedValue({ facilityId: id } as never);
  vi.mocked(listGhgEntryTemplates).mockResolvedValue([{ ...fixture, credit_type: "REDUCTION" } as IsometricGhgEntryTemplate]);
  expect(await switchCreditBatchRemovalTemplate({ creditBatchId: id, removalTemplateId: fixture.id, expectedVersion: 1 }))
    .toEqual({ success: false, error: "This template is not a Removal template. Choose a Removal template for this credit batch." });
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
});

it("still observes the template facts before switching", async () => {
  vi.mocked(getCreditBatchById).mockResolvedValue({ facilityId: id } as never);
  vi.mocked(switchTemplate).mockResolvedValue({ id } as never);
  const input = { creditBatchId: id, removalTemplateId: fixture.id, expectedVersion: 1 };
  expect(await switchCreditBatchRemovalTemplate(input)).toEqual({ success: true, data: { id } });
  expect(loadRemovalTemplateFacts).toHaveBeenCalledWith(ctx, {
    client: {}, template: fixture, externalProjectId: fixture.project_id, blueprints: [],
  });
  expect(switchTemplate).toHaveBeenCalledWith(ctx, input);
  expect(vi.mocked(loadRemovalTemplateFacts).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(switchTemplate).mock.invocationCallOrder[0]);
});

it("lets a member preview an unpinned target in their facility's registry project", async () => {
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
  const result = await loadRemovalTemplateReviewPreview({ facilityId: id, removalTemplateId: fixture.id });
  expect(result).toEqual({ success: true, data: {
    templateId: fixture.id, needsReviewCount: 1, enrichmentProblems: enrichmentProblems(definition, {}), lineSourceProblems: problems,
  } });
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  expect(observeRemovalTemplate).not.toHaveBeenCalled();
  expect(loadTemplateEnrichment).toHaveBeenCalledWith({}, fixture, []);
  expect(requireOrgFacility).toHaveBeenCalledWith(ctx, id);
  expect(getCertifierProjectByFacility).toHaveBeenCalledWith(ctx, id, "isometric");
  expect(listGhgEntryTemplates).toHaveBeenCalledWith({}, fixture.project_id);
});

it("refuses a cross-org facility before reading registry facts", async () => {
  vi.mocked(requireOrgFacility).mockRejectedValueOnce(new Error("Facility not found"));
  expect((await loadRemovalTemplateReviewPreview({ facilityId: id, removalTemplateId: fixture.id })).success).toBe(false);
  expect(listGhgEntryTemplates).not.toHaveBeenCalled();
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
});

it("refuses a preview target absent from the facility project", async () => {
  expect((await loadRemovalTemplateReviewPreview({ facilityId: id, removalTemplateId: "other-project-template" })).success).toBe(false);
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

it("keeps Preview and Entry consistent when live enrichment differs from the stored read", async () => {
  const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
  const lineSources = resolveLineSources({ definition });
  const latest = { definition, lineSources, enrichedAt: new Date(0), semanticFingerprint: semanticFingerprint(definition, {}), fullFingerprint: fullFingerprint(definition, {}) };
  const component = definition.groups.flatMap((group) => group.components).find((component) => component.inputs.length)!;
  const enrichment = { [component.id]: { [component.inputs[0].key]: { unit: "changed-unit" } } };
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(latest as never);
  vi.mocked(loadTemplateEnrichment).mockResolvedValue(enrichment);
  const preview = await loadRemovalTemplateReviewPreview({ facilityId: id, removalTemplateId: fixture.id });
  const entry = await loadRemovalTemplateReviewEntry({ facilityId: id, removalTemplateId: fixture.id });
  if (!preview.success || !entry.success) throw new Error("expected preview reads");
  expect(preview.data).toEqual({
    templateId: fixture.id,
    needsReviewCount: entry.data.lines.filter((line) => lineNeedsReview(line.component.id, line.contract, entry.data.lineSourceProblems)).length,
    enrichmentProblems: entry.data.enrichmentProblems,
    lineSourceProblems: entry.data.lineSourceProblems,
  });
  expect(entry.data.lines.find((line) => line.contract.origin === "carried")).toBeDefined();
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  expect(observeRemovalTemplate).not.toHaveBeenCalled();
});

describe("preview observation enrichment reuse", () => {
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

  it("uses fresh complete stored enrichment for Preview and Entry without loading blueprints or writing", async () => {
    const latest = storedObservation(0);
    const before = structuredClone(latest);
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(latest as never);
    const input = { facilityId: id, removalTemplateId: template.id };
    const preview = await loadRemovalTemplateReviewPreview(input);
    const entry = await loadRemovalTemplateReviewEntry(input);
    expect(preview).toEqual({ success: true, data: {
      templateId: template.id, needsReviewCount: 1, enrichmentProblems: [],
      lineSourceProblems: [{ code: "unassigned", componentId: component.id }],
    } });
    expect(entry).toMatchObject({ success: true, data: {
      observation: null, preview: true, enrichment: storedEnrichment, enrichmentProblems: [],
      lineSourceProblems: [{ code: "unassigned", componentId: component.id }],
    } });
    expect(enrichmentProblems(definition, liveEnrichment)).toEqual([
      { code: "unknown-enrichment", componentId: component.id, inputKey: "grid_carbon_intensity" },
    ]);
    expect(loadTemplateEnrichment).not.toHaveBeenCalled();
    expect(listComponentBlueprints).not.toHaveBeenCalled();
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(observeRemovalTemplate).not.toHaveBeenCalled();
    expect(reviewLineContracts).not.toHaveBeenCalled();
    expect(latest).toEqual(before);
  });

  it("loads live enrichment for a stored observation older than the TTL", async () => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(storedObservation(TEMPLATE_ENRICHMENT_TTL_MS + 1) as never);
    const result = await loadRemovalTemplateReviewPreview({ facilityId: id, removalTemplateId: template.id });
    expect(result).toEqual({ success: true, data: {
      templateId: template.id, needsReviewCount: 0,
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
