import { beforeEach, expect, it, vi } from "vitest";
import { resetPassword, signInWithPassword } from "./better-auth-client";
const { signIn, mockResetPassword } = vi.hoisted(() => ({
  signIn: vi.fn(),
  mockResetPassword: vi.fn(),
}));
vi.mock("better-auth/react", () => ({ createAuthClient: () => ({
  signIn: { email: signIn },
  resetPassword: mockResetPassword,
}) }));
vi.mock("better-auth/client/plugins", () => ({ organizationClient: () => ({}) }));
vi.mock("@better-auth/oauth-provider/client", () => ({ oauthProviderClient: () => ({}) }));
beforeEach(() => vi.clearAllMocks());
it.each([
  ["invalid token", "Invalid or expired link."],
  ["token expired", "This link has expired. Request a new one."],
])("reports a resolved password reset refusal: %s", async (message, mappedMessage) => {
  mockResetPassword.mockResolvedValue({ data: null, error: { message } });
  expect(await resetPassword("refused-token", "test-password"))
    .toEqual({ success: false, error: mappedMessage });
});
it("reports a successful password reset", async () => {
  mockResetPassword.mockResolvedValue({ data: { status: true }, error: null });
  expect(await resetPassword("valid-token", "test-password")).toEqual({ success: true });
  expect(mockResetPassword).toHaveBeenCalledExactlyOnceWith({
    token: "valid-token", newPassword: "test-password",
  });
});
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
