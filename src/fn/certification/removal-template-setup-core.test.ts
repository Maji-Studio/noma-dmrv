import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { fullFingerprint, normalizeTemplateDefinition, resolveLineSources, semanticFingerprint, validateLineSources } from "@/lib/isometric/template-observations";

const mocks = vi.hoisted(() => ({ facility: vi.fn(), mapping: vi.fn(), templates: vi.fn(), latest: vi.fn(), previous: vi.fn(), facts: vi.fn(), preview: vi.fn(), apply: vi.fn(), transaction: vi.fn(), batches: vi.fn(), facilityGuard: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/data-access/facilities", () => ({ getFacilityById: mocks.facility }));
vi.mock("@/data-access/certification", () => ({ getCertifierProjectByFacility: mocks.mapping }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: mocks.facilityGuard }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => ({})) }));
vi.mock("@/data-access/removal-template-observations", () => ({ getLatestTemplateObservation: mocks.latest, getPreviousTemplateObservation: mocks.previous }));
vi.mock("@/data-access/removal-template-setup", async () => {
  const { DomainError } = await import("@/lib/domain-errors");
  return { applySetupInTransaction: mocks.apply, listSetupCreditBatches: mocks.batches, staleSetupTemplate: () => new DomainError("stale_version", "The template changed in Isometric. Review it again.") };
});
vi.mock("@/lib/isometric", async (original) => ({ ...await original<typeof import("@/lib/isometric")>(), listGhgEntryTemplates: mocks.templates, listComponentBlueprints: vi.fn(async () => []), listProjects: vi.fn(async () => [{ id: fixture.project_id, name: "Project" }]) }));
vi.mock("./removal-template-facts", () => ({ loadRemovalTemplateFacts: mocks.facts }));
vi.mock("./removal-template-preview-core", () => ({ readOnlyEntry: mocks.preview }));
vi.mock("@/lib/auth/providers/better-auth-server", () => ({}));
import { applyRemovalTemplateSetupCore, loadRemovalTemplateSetupCore } from "./removal-template-setup-core";

afterEach(() => vi.unstubAllEnvs());

const ctx: OrgContext = { organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false };
const input: ApplyRemovalTemplateSetupInput = { facilityId: "facility", removalTemplateId: fixture.id, fingerprints: { semanticFingerprint: "semantic", fullFingerprint: "full" }, answers: {}, overrides: {}, makeDefault: true, batches: [] };
const definition = normalizeTemplateDefinition(fixture as Parameters<typeof normalizeTemplateDefinition>[0]);
const observation = { id: "observation", version: 1, definition, enrichment: {}, lineSources: resolveLineSources({ definition }), ...input.fingerprints };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.facility.mockResolvedValue({ id: input.facilityId, name: "Facility", durabilityOption: "1000_year" });
  mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, defaultRemovalTemplateId: null });
  mocks.templates.mockResolvedValue([fixture]);
  mocks.latest.mockResolvedValue(observation);
  mocks.previous.mockResolvedValue(null);
  mocks.batches.mockResolvedValue([]);
  mocks.facts.mockResolvedValue({ observation, enrichmentProblems: [], lineSourceProblems: [] });
  mocks.preview.mockResolvedValue({ enrichment: {}, enrichmentProblems: [], lines: definition.groups.flatMap((group) => group.components.map((component) => ({ component, contract: observation.lineSources[component.id] }))) });
  mocks.transaction.mockImplementation((callback) => callback("transaction"));
});
it("refuses Member before any read", async () => {
  await expect(applyRemovalTemplateSetupCore({ ...ctx, orgRole: "member" }, input)).rejects.toThrow("permission");
  expect(mocks.facilityGuard).not.toHaveBeenCalled();
  expect(mocks.templates).not.toHaveBeenCalled();
});
it("checks fit before observing", async () => {
  mocks.facility.mockResolvedValue({ durabilityOption: "200_year" });
  await expect(applyRemovalTemplateSetupCore(ctx, input)).rejects.toThrow("durability");
  expect(mocks.facts).not.toHaveBeenCalled();
});
it("refuses unread templates and fingerprint drift before the apply transaction", async () => {
  mocks.facts.mockResolvedValueOnce({ observation: null });
  await expect(applyRemovalTemplateSetupCore(ctx, input)).rejects.toThrow();
  await expect(applyRemovalTemplateSetupCore(ctx, { ...input, fingerprints: { ...input.fingerprints, fullFingerprint: "old" } })).rejects.toMatchObject({ code: "stale_version" });
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("delegates all setup writes to one transaction after observing", async () => {
  await applyRemovalTemplateSetupCore(ctx, input);
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  expect(mocks.apply).toHaveBeenCalledWith(ctx, "transaction", input, fixture, observation, null);
});
it("previews an unused template even when it has a stored observation", async () => {
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result.fitting).toHaveLength(1);
  expect(result.projectName).toBe("Project");
  expect(mocks.preview).toHaveBeenCalledWith({}, fixture, [], observation, fixture.project_id);
  expect(mocks.facts).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("keeps an added decision visible when an unused template already has a matching observation", async () => {
  const added = definition.groups.flatMap((group) => group.components)[0];
  const olderDefinition = structuredClone(definition);
  for (const group of olderDefinition.groups) group.components = group.components.filter((component) => component.id !== added.id);
  const lineSources = Object.fromEntries(Object.entries(observation.lineSources).map(([id, contract]) => [
    id, { ...contract, origin: id === added.id ? "proposed" as const : "carried" as const },
  ]));
  mocks.latest.mockResolvedValue({ ...observation, lineSources,
    semanticFingerprint: semanticFingerprint(definition, {}),
    fullFingerprint: fullFingerprint(definition, {}),
  });
  mocks.previous.mockResolvedValue({ ...observation, id: "older", definition: olderDefinition });
  mocks.preview.mockResolvedValue({ enrichment: {}, enrichmentProblems: [],
    lines: definition.groups.flatMap((group) => group.components.map((component) => ({ component, contract: lineSources[component.id] }))),
  });
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(mocks.previous).toHaveBeenCalledWith(ctx, "isometric", fixture.id, observation.id);
  expect(result.fitting[0].plan.decisions).toContainEqual(expect.objectContaining({ id: added.id, kind: "added" }));
  expect(mocks.facts).not.toHaveBeenCalled();
});
it.each(["default", "pinned"])("refreshes facts for a %s template", async (use) => {
  if (use === "default") mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, defaultRemovalTemplateId: fixture.id });
  else mocks.batches.mockResolvedValue([{ id: "batch", code: "CB", version: 1, removalTemplateId: fixture.id }]);
  await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(mocks.facts).toHaveBeenCalledTimes(1);
  expect(mocks.preview).not.toHaveBeenCalled();
});
it("omits Reductions, names non-fitting Removals once and marks Members read-only", async () => {
  mocks.templates.mockResolvedValue([{ ...fixture, credit_type: "REDUCTION" }, { ...fixture, id: "empty", groups: [] }]);
  const result = await loadRemovalTemplateSetupCore({ ...ctx, orgRole: "member" }, input.facilityId);
  expect(result.fitting).toEqual([]);
  expect(result.notFitting).toEqual([{ id: "empty", name: fixture.display_name, reason: "This template has no storage component." }]);
  expect(result.viewerCanManage).toBe(false);
});

it("applies the source availability gate to every setup response contract", async () => {
  vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", "true");
  const component = definition.groups.flatMap((group) => group.components)[0];
  mocks.preview.mockResolvedValue({ enrichment: {}, enrichmentProblems: [], lines: [{ component,
    contract: { scope: "operating", entryPolicy: "additive", automaticSource: "sample-transport", origin: "proposed" } }] });
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  const { plan } = result.fitting[0];
  const lines = [...plan.decided, ...plan.defaults, ...plan.decisions.flatMap((decision) => decision.components)];
  expect(lines.every((line) => line.contract?.automaticSource !== "sample-transport")).toBe(true);
});


it("keeps raw retired-source problems after hiding that source from the browser", async () => {
  vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", "true");
  const retiredId = "rtc_1M4ZRPH1RSBXADG2";
  const lineSources = { ...observation.lineSources, [retiredId]: {
    scope: "operating" as const, entryPolicy: "none" as const, origin: "reviewed" as const, automaticSource: "sample-transport" as const,
  } };
  mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, defaultRemovalTemplateId: fixture.id });
  mocks.facts.mockResolvedValue({ observation: { ...observation, lineSources }, enrichmentProblems: [], lineSourceProblems: validateLineSources(definition, lineSources) });
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result.fitting[0].ready).toBe(false);
  expect(result.fitting[0].plan.decided.some((line) => line.component.id === retiredId)).toBe(false);
  expect(result.fitting[0].plan.defaults.find((line) => line.component.id === retiredId)?.proposal.assignments[retiredId]).toEqual({ scope: "operating", entryPolicy: "additive" });
});
