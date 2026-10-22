import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import type { OrgContext } from "@/lib/auth/server";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { fullFingerprint, normalizeTemplateDefinition, resolveLineSources, semanticFingerprint, validateLineSources } from "@/lib/isometric/template-observations";
import { setupPlanFingerprint } from "@/lib/certification/removal-template-setup-fingerprint";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";

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
const input: ApplyRemovalTemplateSetupInput = { facilityId: "facility", removalTemplateId: fixture.id, fingerprints: { semanticFingerprint: "semantic", fullFingerprint: "full" }, planFingerprint: "plan", answers: {}, overrides: {}, batchVersions: [] };
const definition = normalizeTemplateDefinition(fixture as Parameters<typeof normalizeTemplateDefinition>[0]);
const observation = { id: "observation", version: 1, definition, enrichment: {}, lineSources: resolveLineSources({ definition }), ...input.fingerprints };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.facility.mockResolvedValue({ id: input.facilityId, name: "Facility", durabilityOption: "1000_year" });
  mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: null });
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
it("refuses a non-Removal template with the setup refusal, not the credit batch one", async () => {
  mocks.templates.mockResolvedValue([{ ...fixture, credit_type: "REDUCTION" }]);
  await expect(applyRemovalTemplateSetupCore(ctx, input)).rejects.toThrow(new SafeError("This is not a Removal template."));
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
  expect(mocks.apply).toHaveBeenCalledWith(ctx, "transaction", input, fixture, observation);
});
it("previews an unused template even when it has a stored observation", async () => {
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result.fitting).toHaveLength(1);
  expect(result.projectName).toBe("Project");
  expect(mocks.preview).toHaveBeenCalledWith({}, fixture, [], observation, fixture.project_id);
  expect(mocks.facts).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it.each(["preview", "observed"])("reports unfixable blockers on fitting templates from %s", async (read) => {
  const missingFixed = structuredClone(fixture);
  missingFixed.id = "missing-fixed";
  const fixedInput = missingFixed.groups.flatMap((group) => group.components.flatMap((component) => component.inputs))
    .find((input) => input.type === "fixed")!;
  fixedInput.datapoint_id = null;
  mocks.templates.mockResolvedValue([missingFixed, fixture]);
  if (read === "observed") mocks.batches.mockResolvedValue([
    { id: "missing-batch", removalTemplateId: missingFixed.id }, { id: "complete-batch", removalTemplateId: fixture.id },
  ]);
  else mocks.latest.mockResolvedValue(null);
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result.fitting).toMatchObject([
    { id: missingFixed.id, blockedReason: REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint },
    { id: fixture.id, blockedReason: null },
  ]);
  expect(result.notFitting).toEqual([]);
});
it.each(["preview", "observed"])("reports incomplete enrichment after missing fixed datapoints for %s", async (read) => {
  const missingFixed = structuredClone(fixture);
  missingFixed.id = "missing-fixed";
  missingFixed.groups.flatMap((group) => group.components.flatMap((component) => component.inputs))
    .find((input) => input.type === "fixed")!.datapoint_id = null;
  mocks.templates.mockResolvedValue([missingFixed, fixture]);
  const enrichmentProblems = [{ code: "unread" }];
  if (read === "observed") {
    mocks.batches.mockResolvedValue([
      { id: "missing-batch", removalTemplateId: missingFixed.id }, { id: "complete-batch", removalTemplateId: fixture.id },
    ]);
    mocks.facts.mockResolvedValue({ observation, enrichmentProblems, lineSourceProblems: [] });
  } else mocks.preview.mockResolvedValue({ enrichment: {}, enrichmentProblems, lines: [] });
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result.fitting).toMatchObject([
    { id: missingFixed.id, blockedReason: REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint },
    { id: fixture.id, blockedReason: REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead },
  ]);
});
it("fingerprints a preview without a stored observation the same way as the first observed plan", async () => {
  mocks.latest.mockResolvedValue(null);
  const preview = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(mocks.facts).not.toHaveBeenCalled();
  mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: fixture.id });
  const stored = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(preview.fitting[0].planFingerprint).toBe(setupPlanFingerprint(preview.fitting[0].plan));
  expect(preview.fitting[0].planFingerprint).toBe(stored.fitting[0].planFingerprint);
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
  if (use === "default") mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: fixture.id });
  else mocks.batches.mockResolvedValue([{ id: "batch", code: "CB", version: 1, removalTemplateId: fixture.id }]);
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result.viewerCanManage).toBe(true);
  expect(mocks.facts).toHaveBeenCalledExactlyOnceWith(ctx, {
    client: {}, template: fixture, externalProjectId: fixture.project_id, blueprints: [],
  });
  expect(mocks.preview).not.toHaveBeenCalled();
});
it.each(["default", "pinned", "unused"])("never observes a %s template for a Member", async (use) => {
  if (use === "default") mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: fixture.id });
  if (use === "pinned") mocks.batches.mockResolvedValue([{ id: "batch", code: "CB", version: 1, removalTemplateId: fixture.id }]);
  const member: OrgContext = { ...ctx, orgRole: "member" };
  const result = await loadRemovalTemplateSetupCore(member, input.facilityId);
  expect(result.fitting).toHaveLength(1);
  expect(result.viewerCanManage).toBe(false);
  expect(mocks.preview).toHaveBeenCalledWith({}, fixture, [], observation, fixture.project_id);
  expect(mocks.facts).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.facilityGuard).toHaveBeenCalledWith(member, input.facilityId);
});
it.each(["matching", "missing"])("keeps a Member's default template read-only with a %s observation", async (stored) => {
  const latest = stored === "matching" ? { ...observation,
    semanticFingerprint: semanticFingerprint(definition, {}),
    fullFingerprint: fullFingerprint(definition, {}),
  } : null;
  mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: fixture.id });
  mocks.latest.mockResolvedValue(latest);
  const member: OrgContext = { ...ctx, orgRole: "member" };
  const result = await loadRemovalTemplateSetupCore(member, input.facilityId);
  expect(result.fitting).toHaveLength(1);
  expect(mocks.preview).toHaveBeenCalledWith({}, fixture, [], latest, fixture.project_id);
  if (latest) expect(mocks.previous).toHaveBeenCalledWith(member, "isometric", fixture.id, latest.id);
  else expect(mocks.previous).not.toHaveBeenCalled();
  expect(mocks.facts).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
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
  mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: fixture.id });
  mocks.facts.mockResolvedValue({ observation: { ...observation, lineSources }, enrichmentProblems: [], lineSourceProblems: validateLineSources(definition, lineSources) });
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result.fitting[0].ready).toBe(false);
  expect(result.fitting[0].plan.decided.some((line) => line.component.id === retiredId)).toBe(false);
  expect(result.fitting[0].plan.decisions.find((decision) => decision.id === retiredId)?.options[0].assignments[retiredId]).toEqual({ scope: "operating", entryPolicy: "additive" });
});

it("previews each candidate's switching and kept batches with current-template metadata", async () => {
  mocks.mapping.mockResolvedValue({ externalProjectId: fixture.project_id, removalTemplateId: "older" });
  mocks.templates.mockResolvedValue([fixture, { ...fixture, id: "older", display_name: "Older template" }]);
  mocks.batches.mockResolvedValue([
    { id: "unassigned", code: "CB-1", version: 1, removalTemplateId: null, reason: null },
    { id: "older", code: "CB-2", version: 2, removalTemplateId: "older", reason: null },
    { id: "sent", code: "CB-3", version: 3, removalTemplateId: "older", reason: "removalSent" },
    { id: "archived", code: "CB-4", version: 4, removalTemplateId: "older", reason: "archived" },
    { id: "certified", code: "CB-5", version: 5, removalTemplateId: "older", reason: "certified" },
    { id: "current", code: "CB-6", version: 6, removalTemplateId: fixture.id, reason: null },
  ]);
  const result = await loadRemovalTemplateSetupCore(ctx, input.facilityId);
  expect(result).toMatchObject({ removalTemplateId: "older", currentTemplateName: "Older template" });
  expect(result.fitting[0].batchesThatSwitch).toEqual([{ id: "unassigned", code: "CB-1" }, { id: "older", code: "CB-2" }]);
  expect(result.fitting[0].batchesKept).toEqual([
    { id: "sent", code: "CB-3", templateName: "Older template", reason: "removalSent" },
    { id: "archived", code: "CB-4", templateName: "Older template", reason: "archived" },
    { id: "certified", code: "CB-5", templateName: "Older template", reason: "certified" },
  ]);
  expect(result.batchVersions).toHaveLength(6);
});
