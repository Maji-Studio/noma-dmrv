import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mockReadState = vi.fn();
const mockCreateAccount = vi.fn();
const mockHashPassword = vi.fn();
const mockSignInEmail = vi.fn();
const mockAcceptInvitation = vi.fn();
const mockSetActiveOrganization = vi.fn();

vi.mock("@/data-access/invitation-bootstrap", () => ({
  getInvitationBootstrapState: (...args: unknown[]) => mockReadState(...args),
  createInvitedAccount: (...args: unknown[]) => mockCreateAccount(...args),
}));

vi.mock("@/lib/auth/hash-password", () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
}));

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    api: {
      signInEmail: (...args: unknown[]) => mockSignInEmail(...args),
      acceptInvitation: (...args: unknown[]) => mockAcceptInvitation(...args),
      setActiveOrganization: (...args: unknown[]) =>
        mockSetActiveOrganization(...args),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [{ name: "better-auth.session_token", value: "signed" }],
  }),
}));

import { bootstrapInvitationAccountAction } from "@/fn/invitation-bootstrap";

const INVITATION_ID = "invitation-123";
const ORGANIZATION_ID = "organization-123";
const EMAIL = "invitee@example.com";
const VALID_INPUT = {
  invitationId: INVITATION_ID,
  name: "Invitee",
  password: "correct-horse-battery-staple",
};

describe("bootstrapInvitationAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadState.mockResolvedValue({
      invitationId: INVITATION_ID,
      organizationId: ORGANIZATION_ID,
      email: EMAIL,
      accountExists: false,
    });
    mockHashPassword.mockResolvedValue("password-hash");
    mockCreateAccount.mockResolvedValue({
      userId: "user-123",
      organizationId: ORGANIZATION_ID,
      email: EMAIL,
    });
    mockAcceptInvitation.mockResolvedValue({
      invitation: { organizationId: ORGANIZATION_ID },
    });
  });

  it("rejects malformed input before reading the invitation", async () => {
    const result = await bootstrapInvitationAccountAction({
      invitationId: INVITATION_ID,
      name: "",
      password: "short",
      email: EMAIL,
    });

    expect(result.success).toBe(false);
    expect(mockReadState).not.toHaveBeenCalled();
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired invitation", async () => {
    mockReadState.mockRejectedValue(
      new SafeError("Invitation not found, expired, or already used.")
    );

    const result = await bootstrapInvitationAccountAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Invitation not found, expired, or already used.",
    });
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });

  it("directs an invitee with an existing account to sign in", async () => {
    mockReadState.mockResolvedValue({
      invitationId: INVITATION_ID,
      organizationId: ORGANIZATION_ID,
      email: EMAIL,
      accountExists: true,
    });

    const result = await bootstrapInvitationAccountAction(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(mockHashPassword).not.toHaveBeenCalled();
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  it("creates, signs in, accepts, and activates for a new account", async () => {
    const result = await bootstrapInvitationAccountAction(VALID_INPUT);

    expect(mockCreateAccount).toHaveBeenCalledWith({
      invitationId: INVITATION_ID,
      name: "Invitee",
      passwordHash: "password-hash",
    });
    expect(mockSignInEmail).toHaveBeenCalledOnce();
    expect(mockAcceptInvitation).toHaveBeenCalledOnce();
    expect(mockSetActiveOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ body: { organizationId: ORGANIZATION_ID } })
    );
    expect(result).toEqual({
      success: true,
      data: { organizationId: ORGANIZATION_ID },
    });
  });
});
