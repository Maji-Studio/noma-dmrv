import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mockCreateOrganizationWithAdmin = vi.fn();
const mockAcceptInvitation = vi.fn();
const mockSetActiveOrganization = vi.fn();
const mockPersistLastActiveOrganization = vi.fn();

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    api: {
      createInvitation: vi.fn(),
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
  isAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/providers/better-auth-server", () => ({
  getBetterAuthSession: vi.fn(),
}));

vi.mock("@/data-access/organizations", () => ({
  cancelInvitationAsPlatformAdmin: vi.fn(),
  createInvitationAsPlatformAdmin: vi.fn(),
  createOrganizationWithAdmin: (...args: unknown[]) =>
    mockCreateOrganizationWithAdmin(...args),
  findMembershipRole: vi.fn(),
  getActiveOrganization: vi.fn(),
  listAllOrganizations: vi.fn(),
  listOrgInvitations: vi.fn(),
  listOrgMembers: vi.fn(),
  persistLastActiveOrganization: (...args: unknown[]) =>
    mockPersistLastActiveOrganization(...args),
  removeMemberAsPlatformAdmin: vi.fn(),
  renameActiveOrganization: vi.fn(),
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

vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmail: vi.fn(),
}));

import { sendEmail } from "@/lib/email/send";
import { auth } from "@/lib/auth/better-auth";
import {
  getActiveOrganization,
  createInvitationAsPlatformAdmin,
  renameActiveOrganization,
  findMembershipRole,
  listOrgInvitations,
  listOrgMembers,
} from "@/data-access/organizations";
import {
  inviteMemberAction,
  renameOrganizationAction,
  acceptInvitationAction,
  createOrganizationAction,
  listInvitationsFn,
  listMembersFn,
  setActiveOrganizationAction,
} from "@/fn/organizations";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { requireOrgContext, requireOrgRole, requirePlatformAdmin, type OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";

const VALID_INPUT = {
  name: "Example Organization",
  adminEmail: "admin@example.com",
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
    vi.mocked(requireOrgContext).mockRejectedValue(new SafeError("Select an organization to continue."));
    expect(await action()).toEqual({ success: false, error: "Select an organization to continue." });
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
    vi.mocked(sendEmail).mockResolvedValue({ sent: true, id: "message-123" });
    mockCreateOrganizationWithAdmin.mockResolvedValue({ id: "organization-123", name: VALID_INPUT.name, firstAdmin: { kind: "member" } });
  });

  it("requires Platform Admin authorization before resolving the admin", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(
      new SafeError("Admin access is required for this action."),
    );

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Admin access is required for this action.",
    });
    expect(mockCreateOrganizationWithAdmin).not.toHaveBeenCalled();
  });

  it("validates and passes the intent key as the organization identity", async () => {
    const intentKey = "A1234567-1234-4123-8123-123456789ABC";
    await createOrganizationAction(VALID_INPUT, { intentKey });
    expect(mockCreateOrganizationWithAdmin).toHaveBeenCalledWith({
      ...VALID_INPUT, organizationId: intentKey.toLowerCase(),
    });
  });

  it("refuses an invalid intent key before creating anything", async () => {
    const result = await createOrganizationAction(VALID_INPUT, { intentKey: "invalid" });
    expect(result.success).toBe(false);
    expect(mockCreateOrganizationWithAdmin).not.toHaveBeenCalled();
  });

  it("passes normalized name and email to the transaction", async () => {
    const result = await createOrganizationAction({
      ...VALID_INPUT,
      name: "  Example Organization  ",
      slug: "  EXAMPLE-ORGANIZATION  ",
      adminEmail: "  ADMIN@EXAMPLE.COM  ",
    });

    expect(requirePlatformAdmin).toHaveBeenCalledOnce();
    expect(mockCreateOrganizationWithAdmin).toHaveBeenCalledWith({
      name: "Example Organization",
      adminEmail: "admin@example.com",
      organizationId: undefined,
    });
    expect(result).toEqual({
      success: true,
      data: { organizationId: "organization-123", organizationName: VALID_INPUT.name, firstAdmin: { kind: "member" } },
    });
  });

  it("returns the first Admin invitation link for an unknown email", async () => {
    mockCreateOrganizationWithAdmin.mockResolvedValue({
      id: "organization-123", name: VALID_INPUT.name,
      firstAdmin: { kind: "invited", invitationId: "invitation-123" },
    });
    expect(await createOrganizationAction(VALID_INPUT)).toEqual({
      success: true,
      data: {
        organizationId: "organization-123", organizationName: VALID_INPUT.name,
        firstAdmin: { kind: "invited", acceptUrl: "http://localhost:3100/accept-invitation/invitation-123", emailSent: true },
      },
    });
  });

  it.each([true, false])("reports emailSent=%s for a new first Admin without losing the created org", async (sent) => {
    mockCreateOrganizationWithAdmin.mockResolvedValue({
      id: "organization-123", name: VALID_INPUT.name,
      firstAdmin: { kind: "invited", invitationId: "invitation-123" },
    });
    vi.mocked(sendEmail).mockResolvedValue(sent
      ? { sent: true, id: "message-123" }
      : { sent: false, reason: "provider-error" });
    expect(await createOrganizationAction(VALID_INPUT)).toMatchObject({
      success: true,
      data: { firstAdmin: { kind: "invited", emailSent: sent } },
    });
    expect(mockCreateOrganizationWithAdmin).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: VALID_INPUT.adminEmail,
      html: expect.stringContaining('href="http://localhost:3100/accept-invitation/invitation-123"'),
    }));
  });

  it("does not send an invitation to an existing first Admin", async () => {
    await createOrganizationAction(VALID_INPUT);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("surfaces Better Auth API errors", async () => {
    mockCreateOrganizationWithAdmin.mockRejectedValue({
      body: { message: "Organization slug is already taken." },
    });

    const result = await createOrganizationAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Organization slug is already taken.",
    });
  });

  it("uses the generic creation error for unexpected failures", async () => {
    mockCreateOrganizationWithAdmin.mockRejectedValue(new Error("database unavailable"));

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
    mockSetActiveOrganization.mockRejectedValue({
      body: { code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION", message: "User is not a member of the organization" },
    });

    const result = await setActiveOrganizationAction({
      organizationId: "organization-123",
    });

    expect(mockPersistLastActiveOrganization).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "You no longer have access to it. If you still need it, ask one of its Admins.",
    });
  });
});

describe("renameOrganizationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOrgRole).mockReset();
    vi.mocked(requireOrgContext).mockResolvedValue(ORG_CONTEXT);
  });

  it.each(["a", "a".repeat(101)])("refuses an invalid name", async (name) => {
    expect(await renameOrganizationAction({ name })).toMatchObject({
      success: false, code: "validation_failed",
    });
    expect(renameActiveOrganization).not.toHaveBeenCalled();
  });

  it("refuses a Member before the write", async () => {
    const member = { ...ORG_CONTEXT, orgRole: "member" as const };
    vi.mocked(requireOrgContext).mockResolvedValue(member);
    vi.mocked(requireOrgRole).mockImplementation(() => {
      throw new SafeError("You don't have permission to perform this action.");
    });
    expect(await renameOrganizationAction({ name: "New name" })).toEqual({
      success: false, error: "You don't have permission to perform this action.",
    });
    expect(requireOrgRole).toHaveBeenCalledWith(member, "admin");
    expect(renameActiveOrganization).not.toHaveBeenCalled();
  });

  it("trims the name and returns the saved name and slug", async () => {
    const saved = { name: "New name", slug: "new-name-2" };
    vi.mocked(renameActiveOrganization).mockResolvedValue(saved);
    expect(await renameOrganizationAction({ name: "  New name  " })).toEqual({ success: true, data: saved });
    expect(requireOrgRole).toHaveBeenCalledWith(ORG_CONTEXT, "admin");
    expect(renameActiveOrganization).toHaveBeenCalledWith(ORG_CONTEXT, { name: "New name" });
  });
});


describe("inviteMemberAction delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOrgRole).mockReset();
    vi.mocked(getActiveOrganization).mockResolvedValue({ name: VALID_INPUT.name } as never);
    vi.mocked(auth.api.createInvitation).mockResolvedValue({ id: "invitation-123" } as never);
    vi.mocked(createInvitationAsPlatformAdmin).mockResolvedValue({ id: "invitation-123" });
  });

  it.each([
    { platform: false, sent: true }, { platform: false, sent: false },
    { platform: true, sent: true }, { platform: true, sent: false },
  ])("sends once and reports $sent for platform=$platform", async ({ platform, sent }) => {
    const ctx = { ...ORG_CONTEXT, orgRole: platform ? null : "admin" as const, isPlatformAdmin: platform };
    vi.mocked(requireOrgContext).mockResolvedValue(ctx);
    vi.mocked(sendEmail).mockResolvedValue(sent
      ? { sent: true, id: "message-123" }
      : { sent: false, reason: "provider-error" });
    expect(await inviteMemberAction({ email: "invitee@example.test", role: "member" })).toEqual({
      success: true,
      data: {
        invitationId: "invitation-123",
        acceptUrl: "http://localhost:3100/accept-invitation/invitation-123",
        emailSent: sent,
      },
    });
    expect(requireOrgRole).toHaveBeenCalledWith(ctx, "admin");
    const writer = platform ? createInvitationAsPlatformAdmin : auth.api.createInvitation;
    const unusedWriter = platform ? auth.api.createInvitation : createInvitationAsPlatformAdmin;
    expect(writer).toHaveBeenCalledOnce();
    expect(unusedWriter).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      type: "org-invite", to: "invitee@example.test", invitationId: "invitation-123",
      organizationId: ctx.organizationId,
      html: expect.stringContaining('href="http://localhost:3100/accept-invitation/invitation-123"'),
    }));
    expect(vi.mocked(writer).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendEmail).mock.invocationCallOrder[0]);
  });

  it("does not write or send when the Admin role check refuses", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue({ ...ORG_CONTEXT, orgRole: "member" });
    vi.mocked(requireOrgRole).mockImplementation(() => { throw new SafeError("Admin access is required."); });
    expect(await inviteMemberAction({ email: "invitee@example.test", role: "member" }))
      .toEqual({ success: false, error: "Admin access is required." });
    expect(auth.api.createInvitation).not.toHaveBeenCalled();
    expect(createInvitationAsPlatformAdmin).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
