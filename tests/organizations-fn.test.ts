import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mockCreateOrganizationWithOwner = vi.fn();
const mockAcceptInvitation = vi.fn();
const mockSetActiveOrganization = vi.fn();
const mockPersistLastActiveOrganization = vi.fn();

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    api: {
      acceptInvitation: (...args: unknown[]) => mockAcceptInvitation(...args),
      setActiveOrganization: (...args: unknown[]) =>
        mockSetActiveOrganization(...args),
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
  createOrganizationWithOwner: (...args: unknown[]) =>
    mockCreateOrganizationWithOwner(...args),
  findMembershipRole: vi.fn(),
  findUserIdByEmail: vi.fn(),
  getActiveOrganization: vi.fn(),
  listAllOrganizations: vi.fn(),
  listOrgInvitations: vi.fn(),
  listOrgMembers: vi.fn(),
  persistLastActiveOrganization: (...args: unknown[]) =>
    mockPersistLastActiveOrganization(...args),
  removeMemberAsPlatformAdmin: vi.fn(),
  updateMemberRoleAsPlatformAdmin: vi.fn(),
}));

vi.mock("@/fn/action-errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fn/action-errors")>()),
  logActionError: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));

vi.mock("@/lib/log", () => ({
  logger: { error: vi.fn() },
  sanitizeErrorMessage: () => "Unexpected failure.",
}));

import {
  findMembershipRole,
  findUserIdByEmail,
  listOrgInvitations,
  listOrgMembers,
} from "@/data-access/organizations";
import {
  acceptInvitationAction,
  createOrganizationAction,
  listInvitationsFn,
  listMembersFn,
  setActiveOrganizationAction,
} from "@/fn/organizations";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { requireOrgContext, requireOrgRole, requirePlatformAdmin, type OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";

const OWNER_USER_ID = "owner-user-123";
const VALID_INPUT = {
  name: "Example Organization",
  slug: "example-organization",
  ownerEmail: "owner@example.com",
};

const ORG_CONTEXT: OrgContext = {
  userId: "user-123",
  organizationId: "organization-123",
  orgRole: "admin",
  isPlatformAdmin: false,
};
const ORG_READS = [
  { name: "members", action: listMembersFn, read: listOrgMembers, message: "Members could not be loaded. Refresh the page and try again.", op: "organization:list-members" },
  { name: "invitations", action: listInvitationsFn, read: listOrgInvitations, message: "Invitations could not be loaded. Refresh the page and try again.", op: "organization:list-invitations" },
] as const;

describe("organization reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOrgRole).mockReset();
    vi.mocked(requireOrgContext).mockResolvedValue(ORG_CONTEXT);
    vi.mocked(listOrgMembers).mockResolvedValue([]);
    vi.mocked(listOrgInvitations).mockResolvedValue([]);
  });

  it.each(ORG_READS)("resolves context once and passes it to the $name read", async ({ action, read }) => {
    expect(await action()).toEqual({ success: true, data: [] });
    expect(requireOrgContext).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(ORG_CONTEXT);
  });

  it.each(ORG_READS)("stops the $name read when authentication fails", async ({ action, read }) => {
    vi.mocked(requireOrgContext).mockRejectedValue(new SafeError("Select an Organization to continue."));
    expect(await action()).toEqual({ success: false, error: "Select an Organization to continue." });
    expect(read).not.toHaveBeenCalled();
    expect(requireOrgRole).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("requires the admin role before loading invitations", async () => {
    vi.mocked(requireOrgRole).mockImplementation(() => { throw new SafeError("Admin access is required."); });
    expect(await listInvitationsFn()).toEqual({ success: false, error: "Admin access is required." });
    expect(requireOrgRole).toHaveBeenCalledWith(ORG_CONTEXT, "admin");
    expect(listOrgInvitations).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("keeps the member read available without an admin role check", async () => {
    await listMembersFn();
    expect(requireOrgRole).not.toHaveBeenCalled();
  });

  it.each(ORG_READS)("preserves $name failure copy and logs its operation", async ({ action, read, message, op }) => {
    vi.mocked(read).mockRejectedValue(new Error("Unexpected failure."));
    expect(await action()).toEqual({ success: false, error: message });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ op }), "organization action failed");
  });
});

describe("createOrganizationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformAdmin).mockResolvedValue({} as never);
    vi.mocked(findUserIdByEmail).mockResolvedValue(OWNER_USER_ID);
    mockCreateOrganizationWithOwner.mockResolvedValue({ id: "organization-123" });
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
    expect(mockCreateOrganizationWithOwner).not.toHaveBeenCalled();
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
    expect(mockCreateOrganizationWithOwner).toHaveBeenCalledWith({
      name: "Example Organization",
      slug: "example-organization",
      ownerUserId: OWNER_USER_ID,
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
    expect(mockCreateOrganizationWithOwner).not.toHaveBeenCalled();
  });

  it("surfaces Better Auth API errors", async () => {
    mockCreateOrganizationWithOwner.mockRejectedValue({
      body: { message: "Organization slug is already taken." },
    });

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Organization slug is already taken.",
    });
  });

  it("uses the generic creation error for unexpected failures", async () => {
    mockCreateOrganizationWithOwner.mockRejectedValue(new Error("database unavailable"));

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Organization was not created. Try again.",
    });
  });
});

describe("acceptInvitationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBetterAuthSession).mockResolvedValue({
      session: { id: "session-123" },
      user: { id: "user-123", role: "user" },
    } as never);
    mockAcceptInvitation.mockResolvedValue({
      invitation: { organizationId: "organization-123" },
    });
    mockSetActiveOrganization.mockResolvedValue(undefined);
    mockPersistLastActiveOrganization.mockResolvedValue(undefined);
  });

  it("persists the accepted organization after switching into it", async () => {
    const result = await acceptInvitationAction({
      invitationId: "invitation-123",
    });

    expect(mockPersistLastActiveOrganization).toHaveBeenCalledWith(
      "user-123",
      "organization-123",
    );
    expect(result).toEqual({
      success: true,
      data: { organizationId: "organization-123" },
    });
  });
});

describe("setActiveOrganizationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBetterAuthSession).mockResolvedValue({
      session: { id: "session-123" },
      user: { id: "user-123", role: "user" },
    } as never);
    vi.mocked(findMembershipRole).mockResolvedValue("member");
    mockSetActiveOrganization.mockResolvedValue(undefined);
    mockPersistLastActiveOrganization.mockResolvedValue(undefined);
  });

  it("persists a member's choice after the plugin validates the switch", async () => {
    const result = await setActiveOrganizationAction({
      organizationId: "organization-123",
    });

    expect(mockSetActiveOrganization).toHaveBeenCalledWith({
      body: { organizationId: "organization-123" },
      headers: expect.any(Headers),
    });
    expect(mockPersistLastActiveOrganization).toHaveBeenCalledWith(
      "user-123",
      "organization-123",
    );
    expect(
      mockSetActiveOrganization.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockPersistLastActiveOrganization.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      success: true,
      data: { organizationId: "organization-123" },
    });
  });

  it("does not persist when the plugin rejects the switch", async () => {
    mockSetActiveOrganization.mockRejectedValue(
      new SafeError("You are not a member of this Organization."),
    );

    const result = await setActiveOrganizationAction({
      organizationId: "organization-123",
    });

    expect(mockPersistLastActiveOrganization).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "You are not a member of this Organization.",
    });
  });
});
