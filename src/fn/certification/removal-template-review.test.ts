import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { reviewLineContracts } from "@/data-access/removal-template-observations";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { requireOrgFacility } from "@/data-access/utils";
import { listGhgEntryTemplates, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources } from "@/lib/isometric/template-observations";
import { loadRemovalTemplateReviewPreview, reviewRemovalTemplateLines, switchCreditBatchRemovalTemplate } from "./removal-template-review";

const ctx = vi.hoisted((): OrgContext => ({ userId: "review-user", organizationId: "review-org", orgRole: "owner", isPlatformAdmin: false }));
vi.mock("../with-action", async () => {
  const { mockWithAction } = await import("../../../tests/helpers/mock-with-action");
  return mockWithAction(ctx);
});
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ reviewLineContracts: vi.fn(), getPreviousTemplateObservation: vi.fn() }));
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
