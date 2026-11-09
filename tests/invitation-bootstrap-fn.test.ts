import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { InvitationAccountExistsError } from "@/data-access/invitation-bootstrap-errors";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({
  logger: { error: logError },
  sanitizeErrorMessage: vi.fn(() => "sanitized"),
}));

const mockReadState = vi.fn();
const mockCreateAccount = vi.fn();
const mockHashPassword = vi.fn();
const mockConsumeSetPasswordRateLimit = vi.fn();
const mockRequestPasswordReset = vi.fn();
const mockGetSession = vi.fn();
const mockSignInEmail = vi.fn();
const mockAcceptInvitation = vi.fn();
const mockSetActiveOrganization = vi.fn();
const mockPersistLastActiveOrganization = vi.fn();

vi.mock("@/data-access/invitation-bootstrap", () => ({
  getInvitationBootstrapState: (...args: unknown[]) => mockReadState(...args),
  createInvitedAccount: (...args: unknown[]) => mockCreateAccount(...args),
  consumeInvitationSetPasswordRateLimit: (...args: unknown[]) => mockConsumeSetPasswordRateLimit(...args),
}));

vi.mock("@/data-access/organizations", () => ({
  persistLastActiveOrganization: (...args: unknown[]) =>
    mockPersistLastActiveOrganization(...args),
}));

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    $context: Promise.resolve({
      password: {
        hash: (...args: unknown[]) => mockHashPassword(...args),
      },
    }),
    api: {
      requestPasswordReset: (...args: unknown[]) => mockRequestPasswordReset(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
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

import { bootstrapInvitationAccountAction, resendInvitationSetPasswordAction } from "@/fn/invitation-bootstrap";

const INVITATION_ID = "invitation-123";
const ORGANIZATION_ID = "organization-123";
const EMAIL = "invitee@example.com";
const VALID_INPUT = {
  invitationId: INVITATION_ID,
  name: "Invitee",
};

describe("bootstrapInvitationAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
    mockConsumeSetPasswordRateLimit.mockResolvedValue(true);
    mockReadState.mockResolvedValue({
      invitationId: INVITATION_ID,
      organizationId: ORGANIZATION_ID,
      email: EMAIL,
      account: "none",
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

  it("returns the shared NUL validation failure without logging when account creation is refused", async () => {
    mockCreateAccount.mockRejectedValueOnce(new Error("Failed query", {
      cause: {
        code: "22021",
        message: 'invalid byte sequence for encoding "UTF8": 0x00',
      },
    }));

    expect(await bootstrapInvitationAccountAction({ ...VALID_INPUT, name: "Invitee\u0000" })).toEqual({
      success: false,
      error: "This value contains a NUL character (U+0000), which noma cannot store. Remove it and retry.",
      code: "validation_failed",
    });
    expect(mockSignInEmail).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("rejects bootstrap while a session is already active", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-999" },
      session: { id: "session-999" },
    });

    const result = await bootstrapInvitationAccountAction(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(mockReadState).not.toHaveBeenCalled();
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired invitation", async () => {
    mockReadState.mockRejectedValue(
      new SafeError(
        "This invitation is invalid, expired, or already used. Ask an Admin for a new invitation.",
      )
    );

    const result = await bootstrapInvitationAccountAction(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      error:
        "This invitation is invalid, expired, or already used. Ask an Admin for a new invitation.",
    });
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });

  it("directs an invitee with an existing account to sign in", async () => {
    mockReadState.mockResolvedValue({
      invitationId: INVITATION_ID,
      organizationId: ORGANIZATION_ID,
      email: EMAIL,
      account: "confirmed",
    });

    const result = await bootstrapInvitationAccountAction(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(mockHashPassword).not.toHaveBeenCalled();
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  it("creates from name only and emails the invited mailbox without starting a session", async () => {
    const result = await bootstrapInvitationAccountAction({ ...VALID_INPUT, email: "ignored@example.test" });
    expect(mockCreateAccount).toHaveBeenCalledExactlyOnceWith({ invitationId: INVITATION_ID, name: "Invitee" });
    expect(mockRequestPasswordReset).toHaveBeenCalledExactlyOnceWith({
      body: { email: EMAIL, redirectTo: `/set-password?invitation=${INVITATION_ID}` },
    });
    expect(mockHashPassword).not.toHaveBeenCalled();
    expect(mockSignInEmail).not.toHaveBeenCalled();
    expect(mockAcceptInvitation).not.toHaveBeenCalled();
    expect(mockSetActiveOrganization).not.toHaveBeenCalled();
    expect(mockPersistLastActiveOrganization).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { emailSent: true } });
  });

  it.each(["pending", "confirmed"])("rechecks a concurrent bootstrap winner with a %s account", async account => {
    mockCreateAccount.mockRejectedValueOnce(new InvitationAccountExistsError());
    mockReadState.mockResolvedValueOnce({
      invitationId: INVITATION_ID, organizationId: ORGANIZATION_ID, email: EMAIL, account: "none",
    }).mockResolvedValueOnce({
      invitationId: INVITATION_ID, organizationId: ORGANIZATION_ID, email: EMAIL, account,
    });

    expect(await bootstrapInvitationAccountAction(VALID_INPUT)).toEqual(account === "pending"
      ? { success: true, data: { emailSent: true } }
      : { success: false, error: "An account already exists for this invitation. Sign in instead." });
    expect(mockReadState).toHaveBeenCalledTimes(2);
    expect(mockReadState).toHaveBeenNthCalledWith(2, INVITATION_ID);
    expect(mockCreateAccount).toHaveBeenCalledExactlyOnceWith(VALID_INPUT);
    if (account === "pending") {
      expect(mockConsumeSetPasswordRateLimit).toHaveBeenCalledExactlyOnceWith(INVITATION_ID);
      expect(mockRequestPasswordReset).toHaveBeenCalledExactlyOnceWith({ body: {
        email: EMAIL, redirectTo: `/set-password?invitation=${INVITATION_ID}`,
      } });
    } else {
      expect(mockConsumeSetPasswordRateLimit).not.toHaveBeenCalled();
      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    }
  });

  it.each([false, true])("retries pending setup without changing the user, sending allowed=%s", async allowed => {
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, organizationId: ORGANIZATION_ID, email: EMAIL, account: "pending" });
    mockConsumeSetPasswordRateLimit.mockResolvedValue(allowed);
    expect(await bootstrapInvitationAccountAction({ ...VALID_INPUT, name: "Ignored name" }))
      .toEqual({ success: true, data: { emailSent: true } });
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(mockConsumeSetPasswordRateLimit).toHaveBeenCalledWith(INVITATION_ID);
  });

  it("resends pending setup using only the invitation id", async () => {
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, email: EMAIL, account: "pending" });
    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID }))
      .toEqual({ success: true, data: { emailSent: true } });
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockRequestPasswordReset).toHaveBeenCalledExactlyOnceWith({ body: {
      email: EMAIL, redirectTo: `/set-password?invitation=${INVITATION_ID}`,
    } });
  });
  it.each(["none", "confirmed"])("refuses resend for a %s account", async account => {
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, email: EMAIL, account });
    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID })).toMatchObject({ success: false });
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });
  it("refuses resend with an active session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "signed-in" } });
    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID })).toMatchObject({ success: false });
    expect(mockReadState).not.toHaveBeenCalled();
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });
});
