import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const authState = vi.hoisted(() => ({
  ctx: {
    userId: "user-1",
    organizationId: "organization-1",
    orgRole: "admin" as "owner" | "admin" | "member" | null,
    isPlatformAdmin: false,
  },
}));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(async () => authState.ctx),
  requireOrgRole: vi.fn(
    (
      ctx: typeof authState.ctx,
      minimumRole: "owner" | "admin" | "member",
    ) => {
      void minimumRole;
      if (
        !ctx.isPlatformAdmin &&
        ctx.orgRole !== "owner" &&
        ctx.orgRole !== "admin"
      ) {
        throw new SafeError("You don't have permission to perform this action.");
      }
    },
  ),
}));

vi.mock("@/data-access/certifier-organization-settings", () => ({
  getRegistrySourceVisibility: vi.fn(),
  upsertRegistrySourceVisibility: vi.fn(),
}));

vi.mock("@/fn/action-errors", () => ({
  logActionError: vi.fn(),
}));

import {
  getRegistrySourceVisibility,
  upsertRegistrySourceVisibility,
} from "@/data-access/certifier-organization-settings";
import {
  loadRegistrySourceVisibility,
  saveRegistrySourceVisibility,
} from "./source-visibility";

beforeEach(() => {
  vi.clearAllMocks();
  authState.ctx = {
    userId: "user-1",
    organizationId: "organization-1",
    orgRole: "admin",
    isPlatformAdmin: false,
  };
  vi.mocked(getRegistrySourceVisibility).mockResolvedValue("private");
  vi.mocked(upsertRegistrySourceVisibility).mockResolvedValue("public");
});

describe("registry Source visibility actions", () => {
  it("loads the organization policy and management capability", async () => {
    const result = await loadRegistrySourceVisibility();

    expect(result).toEqual({
      success: true,
      data: { sourceVisibility: "private", viewerCanManage: true },
    });
    expect(getRegistrySourceVisibility).toHaveBeenCalledWith(
      authState.ctx,
      "isometric",
    );
  });

  it("persists a validated organization/provider policy for admins", async () => {
    const result = await saveRegistrySourceVisibility({
      sourceVisibility: "public",
    });

    expect(result).toEqual({
      success: true,
      data: { sourceVisibility: "public" },
    });
    expect(upsertRegistrySourceVisibility).toHaveBeenCalledWith(authState.ctx, {
      provider: "isometric",
      sourceVisibility: "public",
    });
  });

  it("permits a Platform Admin operating without an organization membership", async () => {
    authState.ctx = {
      ...authState.ctx,
      orgRole: null,
      isPlatformAdmin: true,
    };

    const result = await saveRegistrySourceVisibility({
      sourceVisibility: "public",
    });

    expect(result.success).toBe(true);
    expect(upsertRegistrySourceVisibility).toHaveBeenCalledWith(authState.ctx, {
      provider: "isometric",
      sourceVisibility: "public",
    });
  });

  it("shows members the policy but refuses mutation", async () => {
    authState.ctx = {
      ...authState.ctx,
      orgRole: "member",
    };

    const readResult = await loadRegistrySourceVisibility();
    const writeResult = await saveRegistrySourceVisibility({
      sourceVisibility: "public",
    });

    expect(readResult).toMatchObject({
      success: true,
      data: { viewerCanManage: false },
    });
    expect(writeResult).toEqual({
      success: false,
      error: "You don't have permission to perform this action.",
    });
    expect(upsertRegistrySourceVisibility).not.toHaveBeenCalled();
  });
});
