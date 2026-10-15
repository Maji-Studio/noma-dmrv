import { beforeEach, expect, it, vi } from "vitest";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { hasCertifierCredentials } from "@/data-access/certifier-credentials";
import { listPinnedRemovalTemplateIds } from "@/data-access/credit-batch-removal-template";
import { listComponentBlueprints, listGhgEntryTemplates, listProjects, type IsometricComponentBlueprint, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { observeRemovalTemplate } from "./observe-removal-template";
import { loadFacilityCertifierFacts } from "./facility-certifier-facts";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import enrichmentFixture from "../../../tests/fixtures/isometric/sandbox-enrichment-2026-10-15.json";

vi.mock("@/data-access/certification", () => ({ getCertifierProjectByFacility: vi.fn() }));
vi.mock("@/data-access/certifier-credentials", () => ({ hasCertifierCredentials: vi.fn(), resolveIsometricClient: vi.fn(async () => ({})) }));
vi.mock("@/data-access/credit-batch-removal-template", () => ({ listPinnedRemovalTemplateIds: vi.fn() }));
vi.mock("./observe-removal-template", () => ({ observeRemovalTemplate: vi.fn() }));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  listComponentBlueprints: vi.fn(), listGhgEntryTemplates: vi.fn(), listProjects: vi.fn(),
}));
const ctx = makeTestOrgContext();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasCertifierCredentials).mockResolvedValue(true);
  vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id, defaultRemovalTemplateId: null } as never);
  vi.mocked(listPinnedRemovalTemplateIds).mockResolvedValue([fixture.id]);
  vi.mocked(listGhgEntryTemplates).mockResolvedValue([fixture as IsometricGhgEntryTemplate]);
  vi.mocked(listProjects).mockResolvedValue([{ id: fixture.project_id } as never]);
  vi.mocked(listComponentBlueprints).mockResolvedValue(enrichmentFixture.blueprints as IsometricComponentBlueprint[]);
  vi.mocked(observeRemovalTemplate).mockRejectedValue(new Error("Observation write unavailable"));
});
it("observes a pinned template even when the facility has no default", async () => {
  const facts = await loadFacilityCertifierFacts(ctx, "facility-id");
  expect(facts.defaultTemplate).toBeNull();
  expect(facts.templatesById[fixture.id].template.id).toBe(fixture.id);
  expect(facts.removalTemplateIds).toEqual([fixture.id]);
  expect(listPinnedRemovalTemplateIds).toHaveBeenCalledOnce();
  expect(observeRemovalTemplate).toHaveBeenCalledWith(ctx, expect.objectContaining({ template: fixture }));
});
it("keeps the read available but fails closed when observation persistence fails", async () => {
  const facts = await loadFacilityCertifierFacts(ctx, "facility-id");
  const pinned = facts.templatesById[fixture.id];
  expect(pinned.observation).toBeNull();
  expect(pinned.enrichmentProblems.length).toBeGreaterThan(0);
  expect(pinned.lineSourceProblems.some((problem) => problem.code === "missing-contract")).toBe(true);
});
