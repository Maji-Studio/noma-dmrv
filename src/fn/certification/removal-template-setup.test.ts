import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { getCertifierProjectByFacility, updateFacilityDefaultRemovalTemplate, upsertCertifierProject } from "@/data-access/certification";
import { requireOrgFacility } from "@/data-access/utils";
import { listGhgEntryTemplates, listComponentBlueprints, listProjects, type IsometricGhgEntryTemplate } from "@/lib/isometric";
import { loadRemovalTemplateFacts } from "./removal-template-facts";
import { setFacilityDefaultRemovalTemplate, startRemovalTemplateSetup } from "./removal-template-setup";
import { saveFacilityCertifierMapping } from "./facility-mapping";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";

const { ctx, environment } = vi.hoisted(() => ({
  ctx: { userId: "setup-user", organizationId: "setup-org", orgRole: "owner", isPlatformAdmin: false } as OrgContext,
  environment: { ISOMETRIC_ENVIRONMENT: "sandbox" },
}));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { env: { ...original.env, get ISOMETRIC_ENVIRONMENT() { return environment.ISOMETRIC_ENVIRONMENT; } } };
});
vi.mock("../with-action", async () => {
  const { mockWithAction } = await import("../../../tests/helpers/mock-with-action");
  return mockWithAction(ctx);
});
vi.mock("@/data-access/certification", () => ({
  getCertifierProjectByFacility: vi.fn(), updateFacilityDefaultRemovalTemplate: vi.fn(), upsertCertifierProject: vi.fn(),
}));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => ({})) }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn() }));
vi.mock("./removal-template-facts", () => ({ loadRemovalTemplateFacts: vi.fn() }));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  listGhgEntryTemplates: vi.fn(), listProjects: vi.fn(), listComponentBlueprints: vi.fn(async () => []),
}));

const facilityId = "00000000-0000-4000-8000-000000000001";
const input = { facilityId, removalTemplateId: fixture.id };
beforeEach(() => {
  vi.clearAllMocks();
  ctx.orgRole = "owner";
  environment.ISOMETRIC_ENVIRONMENT = "sandbox";
  vi.mocked(requireOrgFacility).mockResolvedValue(undefined as never);
  vi.mocked(getCertifierProjectByFacility).mockResolvedValue({ externalProjectId: fixture.project_id } as never);
  vi.mocked(listGhgEntryTemplates).mockResolvedValue([fixture as IsometricGhgEntryTemplate]);
  vi.mocked(listProjects).mockResolvedValue([{ id: fixture.project_id }] as never);
  vi.mocked(loadRemovalTemplateFacts).mockResolvedValue({ observation: { id: "stored" } } as never);
});

describe.each([
  ["set default", setFacilityDefaultRemovalTemplate],
  ["start setup", startRemovalTemplateSetup],
] as const)("%s guards", (_name, action) => {
  it("rejects members before facility and registry reads", async () => {
    ctx.orgRole = "member";
    expect((await action(input)).success).toBe(false);
    expect(requireOrgFacility).not.toHaveBeenCalled();
    expect(listGhgEntryTemplates).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"] as const)("allows %s and observes the selected template", async (role) => {
    ctx.orgRole = role;
    expect((await action(input)).success).toBe(true);
    expect(requireOrgFacility).toHaveBeenCalledWith(ctx, facilityId);
    expect(loadRemovalTemplateFacts).toHaveBeenCalledWith(ctx, {
      client: {}, template: fixture, externalProjectId: fixture.project_id, blueprints: [],
    });
    expect(listComponentBlueprints).toHaveBeenCalledTimes(1);
  });
  it("refuses a cross-org facility before reading the project", async () => {
    vi.mocked(requireOrgFacility).mockRejectedValueOnce(new Error("Facility not found"));
    expect((await action(input)).success).toBe(false);
    expect(getCertifierProjectByFacility).not.toHaveBeenCalled();
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  });
  it("requires an existing project link", async () => {
    vi.mocked(getCertifierProjectByFacility).mockResolvedValueOnce(null);
    expect(await action(input)).toEqual({ success: false, error: "Link this facility to an Isometric project first." });
    expect(listGhgEntryTemplates).not.toHaveBeenCalled();
  });
  it("refuses templates outside the project and non-Removal templates", async () => {
    expect(await action({ ...input, removalTemplateId: "foreign" })).toEqual({
      success: false, error: "Template no longer exists in Isometric.",
    });
    vi.mocked(listGhgEntryTemplates).mockResolvedValueOnce([{ ...fixture, credit_type: "REDUCTION" } as IsometricGhgEntryTemplate]);
    expect(await action(input)).toEqual({
      success: false, error: "This template is not a Removal template. Choose a Removal template for this credit batch.",
    });
    expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
    expect(updateFacilityDefaultRemovalTemplate).not.toHaveBeenCalled();
  });
});



it("rejects a deprecated sequestration template before storing or choosing it", async () => {
  const template = structuredClone(fixture) as IsometricGhgEntryTemplate;
  const storage = template.groups.flatMap((group) => group.components).find((component) => component.blueprint_key.startsWith("biochar_sequestration_"))!;
  storage.blueprint_key = "biochar_sequestration_1000_year";
  vi.mocked(listGhgEntryTemplates).mockResolvedValueOnce([template]);
  expect((await setFacilityDefaultRemovalTemplate(input)).success).toBe(false);
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
  expect(updateFacilityDefaultRemovalTemplate).not.toHaveBeenCalled();
});

it("starts setup without changing the default and returns only success", async () => {
  expect(await startRemovalTemplateSetup(input)).toEqual({ success: true, data: undefined });
  expect(updateFacilityDefaultRemovalTemplate).not.toHaveBeenCalled();
});

it("does not report setup success when the observation could not be stored", async () => {
  vi.mocked(loadRemovalTemplateFacts).mockResolvedValueOnce({ observation: null } as never);
  expect((await startRemovalTemplateSetup(input)).success).toBe(false);
  expect(updateFacilityDefaultRemovalTemplate).not.toHaveBeenCalled();
});

it("leaves default preservation to the locked mapping write and ignores old form payloads", async () => {
  const mappingInput = {
    facilityId, externalProjectId: fixture.project_id, externalFacilityId: "fcl_test",
    protocolSlug: "biochar", defaultRemovalTemplateId: "ignored",
  };
  expect((await saveFacilityCertifierMapping(mappingInput)).success).toBe(true);
  expect(upsertCertifierProject).toHaveBeenCalledWith(ctx, {
    facilityId, externalProjectId: fixture.project_id, externalFacilityId: "fcl_test",
    protocolSlug: "biochar", provider: "isometric",
  });
  expect(listGhgEntryTemplates).not.toHaveBeenCalled();
  expect(loadRemovalTemplateFacts).not.toHaveBeenCalled();
});
