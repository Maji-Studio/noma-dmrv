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
const mockConsumeSetPasswordRateLimit = vi.fn();
const mockRefundSetPasswordRateLimit = vi.fn();
const RATE_LIMIT_RESERVATION = { refund: mockRefundSetPasswordRateLimit };
const mockRequestPasswordReset = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@/data-access/invitation-bootstrap", () => ({
  getInvitationBootstrapState: (...args: unknown[]) => mockReadState(...args),
  createInvitedAccount: (...args: unknown[]) => mockCreateAccount(...args),
  consumeInvitationSetPasswordRateLimit: (...args: unknown[]) => mockConsumeSetPasswordRateLimit(...args),
}));

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    api: {
      requestPasswordReset: (...args: unknown[]) => mockRequestPasswordReset(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
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

const LINK_FALLBACK = "The link was not sent. Try again.";
const RESEND_FALLBACK = "Send again. If that fails too, ask your Admin for a new invitation.";

describe("bootstrapInvitationAccountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
    mockConsumeSetPasswordRateLimit.mockResolvedValue(RATE_LIMIT_RESERVATION);
    mockRefundSetPasswordRateLimit.mockResolvedValue(undefined);
    mockRequestPasswordReset.mockResolvedValue(undefined);
    mockReadState.mockResolvedValue({
      invitationId: INVITATION_ID,
      organizationId: ORGANIZATION_ID,
      email: EMAIL,
      account: "none",
    });
    mockCreateAccount.mockResolvedValue({
      userId: "user-123",
      organizationId: ORGANIZATION_ID,
      email: EMAIL,
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

    expect(result).toEqual({ success: false, code: "account_exists", error: "An account already exists for this invitation. Sign in instead." });
    expect(mockCreateAccount).not.toHaveBeenCalled();
  });

  it("creates from name only and emails the invited mailbox without starting a session", async () => {
    const result = await bootstrapInvitationAccountAction({ ...VALID_INPUT, email: "ignored@example.test" });
    expect(mockCreateAccount).toHaveBeenCalledExactlyOnceWith({ invitationId: INVITATION_ID, name: "Invitee" });
    expect(mockRequestPasswordReset).toHaveBeenCalledExactlyOnceWith({
      body: { email: EMAIL, redirectTo: `/set-password?invitation=${INVITATION_ID}` },
    });
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
      : { success: false, code: "account_exists", error: "An account already exists for this invitation. Sign in instead." });
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
    mockConsumeSetPasswordRateLimit.mockResolvedValue(allowed ? RATE_LIMIT_RESERVATION : false);
    expect(await bootstrapInvitationAccountAction({ ...VALID_INPUT, name: "Ignored name" }))
      .toEqual({ success: true, data: { emailSent: true } });
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(mockConsumeSetPasswordRateLimit).toHaveBeenCalledWith(INVITATION_ID);
    expect(mockRefundSetPasswordRateLimit).not.toHaveBeenCalled();
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
    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID })).toEqual(account === "confirmed"
      ? { success: false, code: "account_exists", error: "An account already exists for this invitation. Sign in instead." }
      : { success: false, error: "Enter your name to start account setup." });
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });
  it("refuses resend with an active session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "signed-in" } });
    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID })).toMatchObject({ success: false });
    expect(mockReadState).not.toHaveBeenCalled();
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });
  it("uses account setup wording when creating the invited user fails", async () => {
    mockCreateAccount.mockRejectedValueOnce(new Error("write failed"));
    expect(await bootstrapInvitationAccountAction(VALID_INPUT)).toEqual({
      success: false, error: "Your account could not be set up. Try again.",
    });
  });

  it.each([
    [bootstrapInvitationAccountAction, LINK_FALLBACK],
    [resendInvitationSetPasswordAction, RESEND_FALLBACK],
  ] as const)("uses link wording when the email step fails", async (action, error) => {
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, email: EMAIL, account: "pending" });
    mockRequestPasswordReset.mockRejectedValueOnce(new Error("request failed"));
    expect(await action(VALID_INPUT)).toEqual({ success: false, error });
  });

  it.each([
    [bootstrapInvitationAccountAction, LINK_FALLBACK],
    [resendInvitationSetPasswordAction, RESEND_FALLBACK],
  ] as const)("refunds a failed send so an immediate resend sends again", async (action, error) => {
    let available = true;
    mockConsumeSetPasswordRateLimit.mockImplementation(async () => {
      if (!available) return false;
      available = false;
      return RATE_LIMIT_RESERVATION;
    });
    mockRefundSetPasswordRateLimit.mockImplementation(async () => { available = true; });
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, email: EMAIL, account: "pending" });
    mockRequestPasswordReset.mockRejectedValueOnce(new Error("request failed"));

    expect(await action(VALID_INPUT)).toEqual({ success: false, error });
    expect(mockRefundSetPasswordRateLimit).toHaveBeenCalledExactlyOnceWith();
    expect(logError).toHaveBeenCalledWith(expect.any(Object), "invitation password setup email failed");
    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID }))
      .toEqual({ success: true, data: { emailSent: true } });
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(2);
    expect(mockRefundSetPasswordRateLimit).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a resend during cooldown without sending or refunding", async () => {
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, email: EMAIL, account: "pending" });
    mockConsumeSetPasswordRateLimit.mockResolvedValue(false);

    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID }))
      .toEqual({ success: true, data: { emailSent: true } });
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    expect(mockRefundSetPasswordRateLimit).not.toHaveBeenCalled();
  });

  it("preserves the send refusal and logs when the refund also fails", async () => {
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, email: EMAIL, account: "pending" });
    mockRequestPasswordReset.mockRejectedValueOnce(new Error("request failed"));
    mockRefundSetPasswordRateLimit.mockRejectedValueOnce(new Error("refund failed"));

    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID }))
      .toEqual({ success: false, error: RESEND_FALLBACK });
    expect(mockRefundSetPasswordRateLimit).toHaveBeenCalledExactlyOnceWith();
    expect(logError).toHaveBeenCalledWith(expect.any(Object), "invitation password setup cooldown refund failed");
  });

  it("does not refund when consuming the cooldown fails", async () => {
    mockReadState.mockResolvedValue({ invitationId: INVITATION_ID, email: EMAIL, account: "pending" });
    mockConsumeSetPasswordRateLimit.mockRejectedValueOnce(new Error("consume failed"));

    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID }))
      .toEqual({ success: false, error: RESEND_FALLBACK });
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    expect(mockRefundSetPasswordRateLimit).not.toHaveBeenCalled();
  });

  it("uses link wording when resend cannot read the invitation", async () => {
    mockReadState.mockRejectedValueOnce(new Error("read failed"));
    expect(await resendInvitationSetPasswordAction({ invitationId: INVITATION_ID }))
      .toEqual({ success: false, error: RESEND_FALLBACK });
  });

});
