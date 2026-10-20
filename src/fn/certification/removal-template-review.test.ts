import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getLatestTemplateObservation, reviewLineContracts } from "@/data-access/removal-template-observations";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { listPinnedRemovalTemplateIds, switchCreditBatchRemovalTemplate as persistSwitch } from "@/data-access/credit-batch-removal-template";
import { requireOrgFacility } from "@/data-access/utils";
import { listComponentBlueprints, listGhgEntryTemplates, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { observeRemovalTemplate } from "./observe-removal-template";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources } from "@/lib/isometric/template-observations";
import { loadRemovalTemplateReview, loadRemovalTemplateReviewEntry, loadRemovalTemplateReviewPreview, reviewRemovalTemplateLines, switchCreditBatchRemovalTemplate } from "./removal-template-review";

const ctx = vi.hoisted((): OrgContext => ({ userId: "review-user", organizationId: "review-org", orgRole: "owner", isPlatformAdmin: false }));
vi.mock("../with-action", async () => {
  const { mockWithAction } = await import("../../../tests/helpers/mock-with-action");
  return mockWithAction(ctx);
});
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ reviewLineContracts: vi.fn(), getPreviousTemplateObservation: vi.fn(), getLatestTemplateObservation: vi.fn(async () => null) }));
vi.mock("@/lib/isometric/template-observations/load-enrichment", () => ({ loadTemplateEnrichment: vi.fn(async () => ({})) }));
vi.mock("./observe-removal-template", () => ({ observeRemovalTemplate: vi.fn() }));
vi.mock("@/data-access/credit-batch-removal-template", () => ({ switchCreditBatchRemovalTemplate: vi.fn(), listPinnedRemovalTemplateIds: vi.fn(async () => []) }));
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
  ctx.orgRole = "owner";
  vi.mocked(requireOrgFacility).mockResolvedValue(undefined as never);
  vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id } as never);
  vi.mocked(listGhgEntryTemplates).mockResolvedValue([fixture as IsometricGhgEntryTemplate]);
});

describe("project template listing", () => {
  it("lists unused templates as read-only without observing them, even without a default", async () => {
    const result = await loadRemovalTemplateReview(id);
    if (!result.success) throw new Error("expected a read");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ templateId: fixture.id, observation: null, preview: true, isDefault: false, isPinned: false });
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(listComponentBlueprints).toHaveBeenCalledTimes(1);
  });

  it("orders default, pinned and remaining Removal templates and preserves missing references", async () => {
    const template = { ...fixture, groups: [] } as IsometricGhgEntryTemplate;
    const make = (templateId: string) => ({ ...template, id: templateId });
    vi.mocked(listGhgEntryTemplates).mockResolvedValue([
      make("unused-a"), make("stored"), make("pinned"), make("default"), make("unused-b"),
      { ...make("reduction"), credit_type: "REDUCTION" },
    ]);
    vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id, defaultRemovalTemplateId: "default" } as never);
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
    vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id, defaultRemovalTemplateId: "gone" } as never);
    const result = await loadRemovalTemplateReview(id);
    if (!result.success) throw new Error("expected a read");
    expect(result.data[0]).toMatchObject({ templateId: "gone", availability: "missing", isDefault: true, isPinned: false });
    expect(result.data[1]).toMatchObject({ templateId: fixture.id, preview: true });
  });
});

describe("switch readiness", () => {
  const input = { creditBatchId: id, removalTemplateId: fixture.id, expectedVersion: 7 };
  const template = { ...fixture, groups: [] } as IsometricGhgEntryTemplate;
  const observation = { definition: { groups: [] }, lineSources: {}, enrichment: {} };
  const refusal = { success: false, error: "Decide this template's lines in Removal templates before choosing it." };

  beforeEach(() => {
    vi.mocked(getCreditBatchById).mockResolvedValue({ facilityId: id, removalTemplateId: "old" } as never);
    vi.mocked(listGhgEntryTemplates).mockResolvedValue([template]);
  });

  it("refuses an unobserved template before any read can be stored", async () => {
    expect(await switchCreditBatchRemovalTemplate(input)).toEqual(refusal);
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(listComponentBlueprints).not.toHaveBeenCalled();
    expect(persistSwitch).not.toHaveBeenCalled();
  });

  it("refuses an incomplete stored read before refreshing it", async () => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue({
      ...observation, definition: normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate),
    } as never);
    expect(await switchCreditBatchRemovalTemplate(input)).toEqual(refusal);
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  });

  it("refuses an undecided line before refreshing it", async () => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue({
      ...observation, definition: { groups: [{ ...normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate).groups[0],
        components: [{ id: "pending", displayName: "Pending", blueprintKey: "unknown", inputs: [], description: null }],
      }] },
    } as never);
    expect(await switchCreditBatchRemovalTemplate(input)).toEqual(refusal);
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  });

  it("checks the refreshed read and preserves the version argument on a ready switch", async () => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(observation as never);
    vi.mocked(loadRemovalTemplateFacts).mockResolvedValue({
      template, observation, blueprintsForTemplate: [], enrichmentProblems: [], lineSourceProblems: [],
    } as never);
    expect((await switchCreditBatchRemovalTemplate(input)).success).toBe(true);
    expect(persistSwitch).toHaveBeenCalledWith(ctx, input);
  });

  it("refuses when the refreshed read becomes incomplete", async () => {
    vi.mocked(getLatestTemplateObservation).mockResolvedValue(observation as never);
    vi.mocked(loadRemovalTemplateFacts).mockResolvedValue({
      template, observation, blueprintsForTemplate: [],
      enrichmentProblems: [{ componentId: "line", inputKey: "value", code: "unknown-enrichment" }], lineSourceProblems: [],
    } as never);
    expect(await switchCreditBatchRemovalTemplate(input)).toEqual(refusal);
    expect(persistSwitch).not.toHaveBeenCalled();
  });

  it("allows retaining the current template without new readiness requirements", async () => {
    vi.mocked(getCreditBatchById).mockResolvedValue({ facilityId: id, removalTemplateId: fixture.id } as never);
    vi.mocked(loadRemovalTemplateFacts).mockResolvedValue({ observation: null } as never);
    expect((await switchCreditBatchRemovalTemplate(input)).success).toBe(true);
    expect(getLatestTemplateObservation).not.toHaveBeenCalled();
    expect(persistSwitch).toHaveBeenCalledWith(ctx, input);
  });
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

it("lets a member preview an unpinned target in their facility's registry project", async () => {
  ctx.orgRole = "member";
  const definition = normalizeTemplateDefinition(fixture as IsometricGhgEntryTemplate);
  const lineSources = resolveLineSources({ definition });
  lineSources.rtc_1KWHFRM4GSBX5Y7A.origin = "proposed";
  vi.mocked(loadRemovalTemplateFacts).mockResolvedValue({ observation: { lineSources }, enrichmentProblems: [], lineSourceProblems: [] } as never);
  const result = await loadRemovalTemplateReviewPreview({ facilityId: id, removalTemplateId: fixture.id });
  expect(result).toEqual({ success: true, data: {
    templateId: fixture.id, needsReviewCount: 1, enrichmentProblems: [], lineSourceProblems: [],
  } });
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
    vi.mocked(getLatestTemplateObservation).mockResolvedValueOnce({ definition, lineSources } as never);
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
