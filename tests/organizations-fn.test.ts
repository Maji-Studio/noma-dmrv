import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mockCreateOrganization = vi.fn();

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    api: {
      createOrganization: (...args: unknown[]) =>
        mockCreateOrganization(...args),
    },
  },
}));

vi.mock("@/lib/auth/server", () => ({
  getOrgContext: vi.fn(),
  requireOrgContext: vi.fn(),
  requireOrgRole: vi.fn(),
  requirePlatformAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/providers/better-auth-server", () => ({
  getBetterAuthSession: vi.fn(),
}));

vi.mock("@/data-access/organizations", () => ({
  cancelInvitationAsPlatformAdmin: vi.fn(),
  createInvitationAsPlatformAdmin: vi.fn(),
  findMembershipRole: vi.fn(),
  findUserIdByEmail: vi.fn(),
  getActiveOrganization: vi.fn(),
  listAllOrganizations: vi.fn(),
  listOrgInvitations: vi.fn(),
  listOrgMembers: vi.fn(),
  removeMemberAsPlatformAdmin: vi.fn(),
  updateMemberRoleAsPlatformAdmin: vi.fn(),
}));

vi.mock("@/fn/action-errors", () => ({
  logActionError: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));

import { findUserIdByEmail } from "@/data-access/organizations";
import { createOrganizationAction } from "@/fn/organizations";
import { requirePlatformAdmin } from "@/lib/auth/server";

const OWNER_USER_ID = "owner-user-123";
const VALID_INPUT = {
  name: "Example Organization",
  slug: "example-organization",
  ownerEmail: "owner@example.com",
};

describe("createOrganizationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformAdmin).mockResolvedValue({} as never);
    vi.mocked(findUserIdByEmail).mockResolvedValue(OWNER_USER_ID);
    mockCreateOrganization.mockResolvedValue({ id: "organization-123" });
  });

  it("requires Platform Admin authorization before resolving the owner", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(
      new SafeError("Admin access is required for this action."),
    );

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Admin access is required for this action.",
    });
    expect(findUserIdByEmail).not.toHaveBeenCalled();
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("creates through Better Auth with the selected owner user id", async () => {
    const result = await createOrganizationAction({
      ...VALID_INPUT,
      name: "  Example Organization  ",
      slug: "  EXAMPLE-ORGANIZATION  ",
      ownerEmail: "  OWNER@EXAMPLE.COM  ",
    });

    expect(requirePlatformAdmin).toHaveBeenCalledOnce();
    expect(findUserIdByEmail).toHaveBeenCalledWith("owner@example.com");
    expect(mockCreateOrganization).toHaveBeenCalledWith({
      body: {
        name: "Example Organization",
        slug: "example-organization",
        userId: OWNER_USER_ID,
      },
    });
    expect(result).toEqual({
      success: true,
      data: { organizationId: "organization-123" },
    });
  });

  it("returns a clear error when the selected owner has no account", async () => {
    vi.mocked(findUserIdByEmail).mockResolvedValue(null);

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error:
        "No user account found for the owner email. The owner must have an account first.",
    });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("surfaces Better Auth API errors", async () => {
    mockCreateOrganization.mockRejectedValue({
      body: { message: "Organization slug is already taken." },
    });

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Organization slug is already taken.",
    });
  });

  it("uses the generic creation error for unexpected failures", async () => {
    mockCreateOrganization.mockRejectedValue(new Error("database unavailable"));

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Failed to create organization.",
    });
  });
});
