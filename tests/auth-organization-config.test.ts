import { describe, expect, it, vi } from "vitest";

const mockSeedOrgDefaults = vi.fn();

vi.mock("@/db/org-defaults", () => ({
  seedOrgDefaults: (...args: unknown[]) => mockSeedOrgDefaults(...args),
}));

import { db } from "@/db";
import { auth } from "@/lib/auth/better-auth";

type OrganizationPluginOptions = {
  allowUserToCreateOrganization?:
    | boolean
    | ((user: { role?: string }) => boolean | Promise<boolean>);
  organizationHooks?: {
    afterCreateOrganization?: (data: {
      organization: { id: string };
    }) => Promise<void>;
  };
};

function getOrganizationPluginOptions(): OrganizationPluginOptions {
  const plugin = auth.options.plugins?.find(
    (candidate) => candidate.id === "organization",
  );
  if (!plugin) {
    throw new Error("Organization plugin is not configured.");
  }
  return (plugin as unknown as { options: OrganizationPluginOptions }).options;
}

describe("Better Auth organization configuration", () => {
  it("disables direct session-based organization creation", () => {
    const allowCreation =
      getOrganizationPluginOptions().allowUserToCreateOrganization;
    expect(allowCreation).toBe(false);
  });

  it("seeds starter defaults after every plugin-created organization", async () => {
    const afterCreate =
      getOrganizationPluginOptions().organizationHooks
        ?.afterCreateOrganization;
    expect(afterCreate).toBeTypeOf("function");
    if (!afterCreate) {
      throw new Error("Organization after-create hook is not configured.");
    }

    await afterCreate({ organization: { id: "organization-123" } });

    expect(mockSeedOrgDefaults).toHaveBeenCalledWith(db, "organization-123");
  });

  it("does not fail organization creation when starter seeding fails", async () => {
    mockSeedOrgDefaults.mockRejectedValueOnce(new Error("seed unavailable"));
    const afterCreate =
      getOrganizationPluginOptions().organizationHooks
        ?.afterCreateOrganization;

    await expect(
      afterCreate?.({ organization: { id: "organization-123" } }),
    ).resolves.toBeUndefined();
  });
});
