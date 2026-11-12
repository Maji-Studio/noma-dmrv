import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@/config/auth";
import { SafeError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  signIn: vi.fn(),
  headers: new Headers({ origin: "http://localhost:3100" }),
}));
vi.mock("@/data-access/first-run", () => ({ createFirstPlatformAdmin: mocks.create }));
vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: { signInEmail: mocks.signIn } } }));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));

import { createFirstAdminAction } from "./first-run";

const PASSWORD = "first-admin-password";

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ userId: "admin-id", email: "admin@example.test" });
  mocks.signIn.mockReset().mockResolvedValue({ token: "session-token" });
});

describe("createFirstAdminAction", () => {
  it.each([
    { email: "invalid", password: PASSWORD },
    { email: "admin@example.test", password: "x".repeat(AUTH_PASSWORD_MIN_LENGTH - 1) },
    { email: "admin@example.test", password: "x".repeat(AUTH_PASSWORD_MAX_LENGTH + 1) },
    {},
    null,
  ])("rejects invalid input before any write or sign-in: %j", async (input) => {
    const result = await createFirstAdminAction(input);
    expect(result).toMatchObject({ success: false, code: "validation_failed" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([AUTH_PASSWORD_MIN_LENGTH, AUTH_PASSWORD_MAX_LENGTH])("accepts the password boundary %s", async (length) => {
    expect(await createFirstAdminAction({ email: "admin@example.test", password: "x".repeat(length) }))
      .toEqual({ success: true, data: { redirectTo: "/platform/organizations" } });
  });

  it("normalizes the email and signs in server-side with the request headers", async () => {
    expect(await createFirstAdminAction({ email: "  ADMIN@Example.Test  ", password: PASSWORD }))
      .toEqual({ success: true, data: { redirectTo: "/platform/organizations" } });
    expect(mocks.create).toHaveBeenCalledWith({ email: "admin@example.test", password: PASSWORD });
    expect(mocks.signIn).toHaveBeenCalledWith({
      body: { email: "admin@example.test", password: PASSWORD },
      headers: mocks.headers,
    });
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.signIn.mock.invocationCallOrder[0]);
  });

  it("surfaces the closed-setup refusal without signing in", async () => {
    mocks.create.mockRejectedValue(new SafeError("noma dMRV is already set up. Sign in instead."));
    expect(await createFirstAdminAction({ email: "admin@example.test", password: PASSWORD }))
      .toEqual({ success: false, error: "noma dMRV is already set up. Sign in instead." });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("uses the Platform Admin fallback for an unexpected creation failure", async () => {
    mocks.create.mockRejectedValue(new Error("Creation unavailable"));
    expect(await createFirstAdminAction({ email: "admin@example.test", password: PASSWORD }))
      .toEqual({ success: false, error: "Your Platform Admin account could not be created. Try again." });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("sends a committed admin to sign-in if session creation fails", async () => {
    mocks.signIn.mockRejectedValue(new SafeError("Sign-in unavailable"));
    expect(await createFirstAdminAction({ email: "admin@example.test", password: PASSWORD }))
      .toEqual({ success: true, data: { redirectTo: "/login" }, warning: "Your Platform Admin account is ready. Sign in to continue." });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
