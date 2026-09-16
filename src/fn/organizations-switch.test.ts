/**
 * Switching organization and remembering the choice are two outcomes, not one
 * (issue #769). The session moves first; saving the preference afterwards can
 * fail on its own, and when it does the action still reports the switch as
 * done so the client leaves the old organization.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBetterAuthSession: vi.fn(),
  findMembershipRole: vi.fn(),
  persistLastActiveOrganization: vi.fn(),
  setActiveOrganization: vi.fn(),
  requirePlatformAdmin: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], delete: vi.fn() }),
}));

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/auth/better-auth", () => ({
  auth: { api: { setActiveOrganization: mocks.setActiveOrganization } },
}));

vi.mock("@/lib/auth/providers/better-auth-server", () => ({
  getBetterAuthSession: mocks.getBetterAuthSession,
}));

vi.mock("@/lib/auth/server", () => ({
  getOrgContext: vi.fn(),
  requireOrgContext: vi.fn(),
  requireOrgRole: vi.fn(),
  requirePlatformAdmin: mocks.requirePlatformAdmin,
}));

vi.mock("@/data-access/organizations", () => ({
  cancelInvitationAsPlatformAdmin: vi.fn(),
  createInvitationAsPlatformAdmin: vi.fn(),
  createOrganizationWithOwner: vi.fn(),
  findMembershipRole: mocks.findMembershipRole,
  findUserIdByEmail: vi.fn(),
  getActiveOrganization: vi.fn(),
  listAllOrganizations: vi.fn(),
  listOrgInvitations: vi.fn(),
  listOrgMembers: vi.fn(),
  persistLastActiveOrganization: mocks.persistLastActiveOrganization,
  removeMemberAsPlatformAdmin: vi.fn(),
  updateMemberRoleAsPlatformAdmin: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  logger: { error: mocks.loggerError, child: () => ({ error: mocks.loggerError }) },
  sanitizeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { setActiveOrganizationAction } from "./organizations";
import { ORG_PREFERENCE_NOT_SAVED } from "./org-preference";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBetterAuthSession.mockResolvedValue({
    user: { id: USER_ID },
    session: { id: "session" },
  });
  mocks.findMembershipRole.mockResolvedValue("member");
  mocks.persistLastActiveOrganization.mockResolvedValue(undefined);
  mocks.setActiveOrganization.mockResolvedValue(undefined);
});

describe("setActiveOrganizationAction", () => {
  it("reports a plain success when the switch and the preference both land", async () => {
    const result = await setActiveOrganizationAction({
      organizationId: ORGANIZATION_ID,
    });

    expect(result).toEqual({
      success: true,
      data: { organizationId: ORGANIZATION_ID },
    });
  });

  it("reports success with a warning when only the preference fails", async () => {
    mocks.persistLastActiveOrganization.mockRejectedValue(
      new Error("preference write failed"),
    );

    const result = await setActiveOrganizationAction({
      organizationId: ORGANIZATION_ID,
    });

    // The session has already moved, so a failed preference write must not
    // strand the client in the old organization.
    expect(result).toEqual({
      success: true,
      data: { organizationId: ORGANIZATION_ID },
      warning: ORG_PREFERENCE_NOT_SAVED,
    });
  });

  it("logs the preference failure with ids only", async () => {
    mocks.persistLastActiveOrganization.mockRejectedValue(
      new Error("preference write failed"),
    );

    await setActiveOrganizationAction({ organizationId: ORGANIZATION_ID });

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
      }),
      "last active organization preference not saved",
    );
    const [logged] = mocks.loggerError.mock.calls[0];
    expect(Object.keys(logged)).not.toContain("email");
    expect(Object.keys(logged)).not.toContain("name");
  });

  it("keeps the failure when the switch itself fails", async () => {
    mocks.setActiveOrganization.mockRejectedValue(
      new Error("plugin rejected the switch"),
    );

    const result = await setActiveOrganizationAction({
      organizationId: ORGANIZATION_ID,
    });

    expect(result.success).toBe(false);
    expect(mocks.persistLastActiveOrganization).not.toHaveBeenCalled();
  });
});
