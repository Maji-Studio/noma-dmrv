import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  requireOrgFacility: vi.fn(),
  loadFacilityCertifierFacts: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));

vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: mocks.requireOrgFacility,
}));

vi.mock("./certify-context-core", () => ({
  loadFacilityCertifierFacts: mocks.loadFacilityCertifierFacts,
}));

vi.mock("../with-action", () => ({
  withAction: async (callback: (ctx: unknown) => Promise<unknown>) => ({
    success: true,
    data: await callback({
      userId: "platform-admin",
      organizationId: "organization-1",
      orgRole: null,
      isPlatformAdmin: true,
    }),
  }),
}));

import { loadRemovalTemplateDiagnostic } from "./removal-template-diagnostic";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadFacilityCertifierFacts.mockResolvedValue({
    hasOrgCredentials: true,
    mapping: {
      externalProjectId: "prj-1",
      defaultRemovalTemplateId: "rvt-1",
    },
    project: { id: "prj-1", name: "Project One" },
    defaultTemplate: {
      id: "rvt-1",
      display_name: "Removal template",
      credit_type: "REMOVAL",
      groups: [],
    },
    missingDefaultTemplateId: null,
    blueprintsForTemplate: [],
    unresolvedBlueprintKeys: [],
    requiredTransportCategories: [],
  });
});

describe("loadRemovalTemplateDiagnostic", () => {
  it("does not load facility or registry facts when the Platform Admin guard rejects", async () => {
    mocks.requireAdminAction.mockRejectedValueOnce(
      new Error("Admin access is required"),
    );

    await expect(
      loadRemovalTemplateDiagnostic(FACILITY_ID),
    ).rejects.toThrow("Admin access is required");
    expect(mocks.requireOrgFacility).not.toHaveBeenCalled();
    expect(mocks.loadFacilityCertifierFacts).not.toHaveBeenCalled();
  });

  it("enforces Platform Admin and facility authorization before loading registry facts", async () => {
    const result = await loadRemovalTemplateDiagnostic(FACILITY_ID);

    expect(mocks.requireAdminAction).toHaveBeenCalledOnce();
    expect(mocks.requireOrgFacility).toHaveBeenCalledWith(
      expect.objectContaining({ isPlatformAdmin: true }),
      FACILITY_ID,
    );
    expect(mocks.loadFacilityCertifierFacts).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "organization-1" }),
      FACILITY_ID,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        availability: "ready",
        selectedTemplateId: "rvt-1",
        project: { linked: true, resolved: true, id: "prj-1" },
        diagnostic: {
          template: { id: "rvt-1", displayName: "Removal template" },
        },
      },
    });
  });
});
