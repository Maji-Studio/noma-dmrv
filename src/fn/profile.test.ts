import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@/config/auth";
import { SafeError } from "@/lib/errors";
import { __resetRateLimitForTests } from "@/lib/rate-limit/in-memory";

const mocks = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
  updateUser: vi.fn(),
  changePassword: vi.fn(),
  changeEmail: vi.fn(),
  revokeOtherSessions: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.requireOrgContext }));
vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: { updateUser: mocks.updateUser, changeEmail: mocks.changeEmail, changePassword: mocks.changePassword, revokeOtherSessions: mocks.revokeOtherSessions } } }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/log", () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn },
  sanitizeErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

import { changeEmailFn, changePasswordFn, updateProfileNameFn } from "./profile";

const USER_ID = "user-1";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const PASSWORD_INPUT = { currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" };
const REQUEST_HEADERS = new Headers({ "x-test-request": "profile" });

beforeEach(() => {
  vi.resetAllMocks();
  __resetRateLimitForTests();
  mocks.requireOrgContext.mockResolvedValue({ userId: USER_ID, organizationId: "org-1", orgRole: "member", isPlatformAdmin: false });
  mocks.headers.mockResolvedValue(REQUEST_HEADERS);
  mocks.updateUser.mockResolvedValue({ status: true });
  mocks.changePassword.mockResolvedValue({ token: null, user: { id: USER_ID } });
  mocks.revokeOtherSessions.mockResolvedValue({ status: true });
});

afterEach(() => { vi.useRealTimers(); });

describe("profile actions", () => {
  it("sends only the trimmed name to updateUser", async () => {
    expect(await updateProfileNameFn({ name: "  Example  ", email: "example@example.com", role: "admin", userId: "other-user" }))
      .toEqual({ success: true, data: { name: "Example" } });
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ body: { name: "Example" }, headers: REQUEST_HEADERS });
  });

  it("changes the password, then signs out the other sessions of this user only", async () => {
    expect(await changePasswordFn({ ...PASSWORD_INPUT, revokeOtherSessions: false, userId: "other-user" }))
      .toEqual({ success: true, data: { otherDevicesSignedOut: true } });
    expect(mocks.changePassword).toHaveBeenCalledExactlyOnceWith({
      body: { currentPassword: PASSWORD_INPUT.currentPassword, newPassword: PASSWORD_INPUT.newPassword, revokeOtherSessions: false },
      headers: REQUEST_HEADERS,
    });
    expect(mocks.revokeOtherSessions).toHaveBeenCalledExactlyOnceWith({ headers: REQUEST_HEADERS });
    expect(mocks.changePassword.mock.invocationCallOrder[0]).toBeLessThan(mocks.revokeOtherSessions.mock.invocationCallOrder[0]);
  });

  it("does not sign out other devices when the password was refused", async () => {
    mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));
    await changePasswordFn(PASSWORD_INPUT);
    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("reports a changed password whose sign-out of other devices failed", async () => {
    mocks.revokeOtherSessions.mockRejectedValue(new Error("lost connection for someone@example.com"));
    expect(await changePasswordFn(PASSWORD_INPUT)).toEqual({ success: true, data: { otherDevicesSignedOut: false } });
    expect(mocks.loggerWarn).toHaveBeenCalledExactlyOnceWith({ op: "change-password", userId: USER_ID }, "other sessions were not signed out");
  });

  it.each([
    ["INVALID_PASSWORD", "currentPassword", "That is not your current password."],
    ["PASSWORD_TOO_SHORT", "newPassword", `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`],
    ["PASSWORD_TOO_LONG", "newPassword", `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`],
  ])("maps %s to an actionable field error", async (code, field, error) => {
    mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code, message: "private upstream message" }));
    expect(await changePasswordFn(PASSWORD_INPUT)).toMatchObject({
      success: false,
      error,
      code: "validation_failed",
      issues: [{ path: [field], code: "validation_failed", message: error }],
    });
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("explains passwordless accounts", async () => {
    mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "CREDENTIAL_ACCOUNT_NOT_FOUND" }));
    expect(await changePasswordFn(PASSWORD_INPUT)).toEqual({ success: false, error: "This account signs in without a password." });
  });

  it("limits failed attempts per user across organizations and resets after the window", async () => {
    vi.useFakeTimers();
    mocks.changePassword.mockRejectedValue(new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) await changePasswordFn(PASSWORD_INPUT);
    mocks.requireOrgContext.mockResolvedValue({ userId: USER_ID, organizationId: "org-2", orgRole: "member", isPlatformAdmin: false });
    expect(await changePasswordFn(PASSWORD_INPUT)).toEqual({ success: false, error: "Too many attempts. Try again in 900s." });
    expect(mocks.changePassword).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    mocks.requireOrgContext.mockResolvedValue({ userId: "user-2", organizationId: "org-2", orgRole: "member", isPlatformAdmin: false });
    await changePasswordFn(PASSWORD_INPUT);
    expect(mocks.changePassword).toHaveBeenCalledTimes(MAX_ATTEMPTS + 1);
    mocks.requireOrgContext.mockResolvedValue({ userId: USER_ID, organizationId: "org-1", orgRole: "member", isPlatformAdmin: false });
    vi.advanceTimersByTime(WINDOW_MS);
    await changePasswordFn(PASSWORD_INPUT);
    expect(mocks.changePassword).toHaveBeenCalledTimes(MAX_ATTEMPTS + 2);
  });

  it("refuses unauthenticated callers before calling either API", async () => {
    mocks.requireOrgContext.mockRejectedValue(new SafeError("Sign in to continue."));
    expect(await updateProfileNameFn({ name: "Example" })).toEqual({ success: false, error: "Sign in to continue." });
    expect(await changePasswordFn(PASSWORD_INPUT)).toEqual({ success: false, error: "Sign in to continue." });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("rejects invalid input before calling either API", async () => {
    expect(await updateProfileNameFn({ name: " " })).toMatchObject({ success: false, code: "validation_failed" });
    expect(await changePasswordFn({ ...PASSWORD_INPUT, confirmPassword: "mismatched-password" })).toMatchObject({ success: false, code: "validation_failed" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("does not log or return raw upstream errors", async () => {
    const sensitiveMessage = "submitted-name submitted-password submitted-email";
    mocks.updateUser.mockRejectedValue(new Error(sensitiveMessage));
    mocks.changePassword.mockRejectedValue(new APIError("INTERNAL_SERVER_ERROR", { message: sensitiveMessage }));
    expect(await updateProfileNameFn({ name: "Example" })).toEqual({ success: false, error: "Your name was not saved. Try again." });
    expect(await changePasswordFn(PASSWORD_INPUT)).toEqual({ success: false, error: "Your password was not changed. Try again." });
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(sensitiveMessage);
  });
});


describe("changeEmailFn", () => {
  const input = { newEmail: "new@example.test" };

  it("validates and forwards only the new address and fixed callback with session headers", async () => {
    expect(await changeEmailFn({ newEmail: "  new@example.test  ", callbackURL: "https://attacker.test", userId: "other-user" }))
      .toEqual({ success: true, data: { status: true } });
    expect(mocks.changeEmail).toHaveBeenCalledExactlyOnceWith({
      body: { ...input, callbackURL: "/settings/profile" }, headers: REQUEST_HEADERS,
    });
  });

  it("rejects malformed addresses on the server", async () => {
    expect(await changeEmailFn({ newEmail: "invalid" })).toMatchObject({ success: false, code: "validation_failed" });
    expect(mocks.changeEmail).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.requireOrgContext.mockRejectedValue(new SafeError("Sign in to continue."));
    expect(await changeEmailFn(input)).toEqual({ success: false, error: "Sign in to continue." });
    expect(mocks.changeEmail).not.toHaveBeenCalled();
  });

  it("translates SESSION_EXPIRED into a typed safe refusal without logging upstream PII", async () => {
    mocks.changeEmail.mockRejectedValue(new APIError("BAD_REQUEST", { code: "SESSION_EXPIRED", message: input.newEmail }));
    expect(await changeEmailFn(input)).toMatchObject({
      success: false, code: "session_expired", error: "Your sign-in is too old to change your email. Sign out and sign in again, then try again.",
    });
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected failures", async () => {
    mocks.changeEmail.mockRejectedValue(new Error(input.newEmail));
    expect(await changeEmailFn(input)).toEqual({ success: false, error: "The confirmation link was not sent. Try again." });
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(input.newEmail);
  });

  it("limits attempts per user across organizations for 15 minutes", async () => {
    vi.useFakeTimers();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) await changeEmailFn(input);
    mocks.requireOrgContext.mockResolvedValue({ userId: USER_ID, organizationId: "org-2", orgRole: "member", isPlatformAdmin: false });
    expect(await changeEmailFn(input)).toEqual({ success: false, error: "Too many attempts. Try again in 900s." });
    expect(mocks.changeEmail).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    mocks.requireOrgContext.mockResolvedValue({ userId: "user-2", organizationId: "org-2", orgRole: "member", isPlatformAdmin: false });
    await changeEmailFn(input);
    expect(mocks.changeEmail).toHaveBeenCalledTimes(MAX_ATTEMPTS + 1);
    mocks.requireOrgContext.mockResolvedValue({ userId: USER_ID, organizationId: "org-1", orgRole: "member", isPlatformAdmin: false });
    vi.advanceTimersByTime(WINDOW_MS);
    await changeEmailFn(input);
    expect(mocks.changeEmail).toHaveBeenCalledTimes(MAX_ATTEMPTS + 2);
  });
});
