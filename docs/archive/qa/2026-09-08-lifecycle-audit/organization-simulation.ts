import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mockCreateOrganizationWithOwner = vi.fn();
const mockAcceptInvitation = vi.fn();
const mockSetActiveOrganization = vi.fn();
const mockPersistLastActiveOrganization = vi.fn();

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

import {
  findMembershipRole,
  findUserIdByEmail,
} from "@/data-access/organizations";
import {
  acceptInvitationAction,
  createOrganizationAction,
  setActiveOrganizationAction,
} from "@/fn/organizations";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { requirePlatformAdmin } from "@/lib/auth/server";


describe("baseline partial-success observation", () => {
  it("F04: organization switches but preference-write failure reports not switched", async () => {
    let activeOrganization = "old-org";
    vi.mocked(getBetterAuthSession).mockResolvedValue({
      user: { id: "audit-user" }, session: { id: "audit-session" },
    } as never);
    vi.mocked(findMembershipRole).mockResolvedValue("member");
    mockSetActiveOrganization.mockImplementation(async () => { activeOrganization = "new-org"; });
    mockPersistLastActiveOrganization.mockRejectedValue(new Error("Injected preference DB failure"));
    const result = await setActiveOrganizationAction({ organizationId: "new-org" });
    expect(activeOrganization).toBe("new-org");
    expect(result).toEqual({ success: false, error: "Organization was not switched. Try again." });
  });
});
