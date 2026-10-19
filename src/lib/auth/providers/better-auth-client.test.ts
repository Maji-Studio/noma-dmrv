import { beforeEach, expect, it, vi } from "vitest";
import { signInWithPassword } from "./better-auth-client";
const signIn = vi.hoisted(() => vi.fn());
vi.mock("better-auth/react", () => ({ createAuthClient: () => ({ signIn: { email: signIn } }) }));
vi.mock("better-auth/client/plugins", () => ({ organizationClient: () => ({}) }));
vi.mock("@better-auth/oauth-provider/client", () => ({ oauthProviderClient: () => ({}) }));
beforeEach(() => vi.clearAllMocks());
it("accepts the OAuth provider's redirect-only response without expecting a user payload", async () => {
  signIn.mockResolvedValue({ data: { redirect: true, url: "https://noma.test/oauth/organization" } });
  expect(await signInWithPassword("e2e@example.test", "test-password")).toEqual({ success: true, redirectUrl: "https://noma.test/oauth/organization" });
});
it("preserves normal verified sign-in results", async () => {
  signIn.mockResolvedValue({ data: { user: { id: "user", emailVerified: true, role: "user", createdAt: new Date(), updatedAt: new Date() }, token: "test-session" } });
  expect(await signInWithPassword("e2e@example.test", "test-password")).toMatchObject({ success: true, data: { user: { id: "user" }, session: { id: "test-session" } } });
});

it.each(["invalid_signature", "access_denied"])("maps OAuth %s to restarting the app flow", async code => {
  signIn.mockResolvedValue({ error: { code, message: "OAuth request refused" } });
  expect(await signInWithPassword("e2e@example.test", "test-password")).toEqual({ success: false, error: "Start again from the app." });
});
it("maps a refused OAuth after-hook error payload", async () => {
  signIn.mockResolvedValue({ error: { error: "access_denied", error_description: "Start again from the app." } });
  expect(await signInWithPassword("e2e@example.test", "test-password")).toEqual({ success: false, error: "Start again from the app." });
});

it.each(["invalid_signature", "access_denied"])("maps a thrown OAuth %s error", async code => {
  signIn.mockRejectedValue(new Error(code));
  expect(await signInWithPassword("e2e@example.test", "test-password")).toEqual({ success: false, error: "Start again from the app." });
});
