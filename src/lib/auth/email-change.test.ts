/** Exercise email changes through the real auth config with an in-memory store. */
import { createHmac } from "node:crypto";
import { createEmailVerificationToken } from "better-auth/api";
import { createAuthClient } from "better-auth/client";
import { signJWT } from "better-auth/crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
const memory = vi.hoisted(() => ({
  user: [] as Record<string, unknown>[],
  session: [] as Record<string, unknown>[],
  account: [] as Record<string, unknown>[],
  verification: [] as Record<string, unknown>[],
}));
// Session creation consults the app database for an organization preference.
// This auth-only store has no organization rows.
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(memory) };
});
vi.mock("@/config/env", async importOriginal => ({
  ...(await importOriginal<typeof import("@/config/env")>()),
  env: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3100/",
    BETTER_AUTH_SECRET: "unit-test-secret-with-at-least-32-characters",
    NODE_ENV: "test",
  },
}));
vi.mock("@/lib/log", () => ({ logger: mocks }));
vi.mock("@/lib/email/send", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()), sendEmail: vi.fn(),
}));

import { sendEmail } from "@/lib/email/send";
import { verifyEmailEmail } from "@/lib/email/templates/verify-email-email";
import { env } from "@/config/env";
import { auth } from "./better-auth";

const ORIGIN = "http://localhost:3100";
const OLD_EMAIL = "current@example.test";
const NEW_EMAIL = "new@example.test";
const USER_ID = "email-change-user";
const SESSION_TOKEN = "email-change-session-token";
const CALLBACK_URL = `${ORIGIN}/settings/profile`;
const MILLISECONDS_PER_SECOND = 1000;
const ONE_HOUR_SECONDS = 60 * 60;
const SESSION_LIFETIME_MS = 7 * 24 * ONE_HOUR_SECONDS * MILLISECONDS_PER_SECOND;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendEmail).mockReset().mockResolvedValue({ sent: true, id: "message-id" });
  Object.values(memory).forEach(rows => rows.splice(0));
  memory.user.push({
    id: USER_ID, email: OLD_EMAIL, name: "Private Name", emailVerified: true,
    role: "user", createdAt: new Date(), updatedAt: new Date(),
  });
  memory.account.push({ id: "credential-id", providerId: "credential", accountId: USER_ID, userId: USER_ID });
  memory.session.push({
    id: "session-id", token: SESSION_TOKEN, userId: USER_ID,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS), createdAt: new Date(), updatedAt: new Date(),
  });
});

afterEach(() => { vi.useRealTimers(); });

async function sessionHeaders(token = SESSION_TOKEN) {
  const ctx = await auth.$context;
  const signature = createHmac("sha256", ctx.secret).update(token).digest("base64");
  return new Headers({
    origin: ORIGIN, "content-type": "application/json",
    cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`,
  });
}

async function requestChange(newEmail = NEW_EMAIL) {
  return auth.handler(new Request(`${ORIGIN}/api/auth/change-email`, {
    method: "POST", headers: await sessionHeaders(),
    body: JSON.stringify({ newEmail, callbackURL: CALLBACK_URL }),
  }));
}

it("sends confirmation to the new address and a notice to the old address, then changes only on confirmation", async () => {
  expect((await requestChange()).status).toBe(200);
  expect(sendEmail).toHaveBeenCalledTimes(2);
  const [confirmation, notice] = vi.mocked(sendEmail).mock.calls.map(([input]) => input);
  expect(confirmation).toMatchObject({
    type: "email-change-confirm", to: NEW_EMAIL, userId: USER_ID,
    subject: "Confirm your new email address for noma",
    text: expect.stringContaining(OLD_EMAIL),
    idempotencyKey: expect.stringContaining(`email-change-confirm/${USER_ID}/`),
  });
  const verificationUrl = new URL(confirmation.text.match(/http[^\s]+\/api\/auth\/verify-email\?[^\s]+/)![0]);
  expect(verificationUrl.origin).toBe(ORIGIN);
  expect(verificationUrl.searchParams.get("callbackURL")).toBe(CALLBACK_URL);
  expect(notice).toMatchObject({
    type: "email-change-notice", to: OLD_EMAIL, userId: USER_ID,
    text: expect.stringContaining(`${ORIGIN}/forgot-password`),
    idempotencyKey: expect.stringContaining(`email-change-notice/${USER_ID}/`),
  });
  expect(notice.text).toContain(NEW_EMAIL);
  for (const email of [confirmation, notice]) {
    expect(email.html).toContain(`src="${ORIGIN}/email/`);
    expect(`${email.html}\n${email.text}`).not.toContain(`${ORIGIN}//`);
  }
  expect(memory.user[0].email).toBe(OLD_EMAIL);

  const verified = await auth.handler(new Request(verificationUrl, { headers: await sessionHeaders() }));
  expect(verified.status).toBe(302);
  expect(verified.headers.get("location")).toBe(CALLBACK_URL);
  expect(memory.user[0]).toMatchObject({ id: USER_ID, email: NEW_EMAIL, emailVerified: true, role: "user" });
  expect(memory.account[0]).toMatchObject({ userId: USER_ID, accountId: USER_ID });
  expect(sendEmail).toHaveBeenCalledTimes(2);
});

it("keeps normal verification on the existing template without a change notice", async () => {
  memory.user[0].emailVerified = false;
  const response = await auth.handler(new Request(`${ORIGIN}/api/auth/send-verification-email`, {
    method: "POST", headers: await sessionHeaders(),
    body: JSON.stringify({ email: OLD_EMAIL, callbackURL: CALLBACK_URL }),
  }));
  expect(response.status).toBe(200);
  expect(sendEmail).toHaveBeenCalledOnce();
  const input = vi.mocked(sendEmail).mock.calls[0][0];
  expect(input).toMatchObject({ type: "verify-email", to: OLD_EMAIL, userId: USER_ID });
  const url = input.text.split("\n").find(line => line.startsWith(`${ORIGIN}/api/auth/verify-email?`));
  expect(url).toBeDefined();
  expect(input).toMatchObject(verifyEmailEmail({ to: OLD_EMAIL, url: url!, appUrl: env.NEXT_PUBLIC_APP_URL }));
  const verified = await auth.handler(new Request(url!, { headers: await sessionHeaders() }));
  expect(verified.status).toBe(302);
  expect(verified.headers.get("location")).toBe(CALLBACK_URL);
  expect(memory.user[0]).toMatchObject({ email: OLD_EMAIL, emailVerified: true });
});

it("silently sends neither email when the requested address already belongs to an account", async () => {
  memory.user.push({ ...memory.user[0], id: "other-user", email: NEW_EMAIL });
  const response = await requestChange();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: true });
  expect(sendEmail).not.toHaveBeenCalled();
  expect(memory.user[0].email).toBe(OLD_EMAIL);
});

it("does not silently change an unverified user's address", async () => {
  memory.user[0].emailVerified = false;
  expect((await requestChange()).status).toBe(200);
  expect(memory.user[0].email).toBe(OLD_EMAIL);
  expect(sendEmail).toHaveBeenCalledTimes(2);
});

it("rejects a session at the default freshness boundary with SESSION_EXPIRED", async () => {
  const ctx = await auth.$context;
  expect(ctx.sessionConfig.freshAge).toBe(24 * ONE_HOUR_SECONDS);
  memory.session[0].createdAt = new Date(Date.now() - ctx.sessionConfig.freshAge * MILLISECONDS_PER_SECOND);
  const response = await requestChange();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  const client = createAuthClient({
    baseURL: ORIGIN,
    disableDefaultFetchPlugins: true,
    fetchOptions: {
      headers: await sessionHeaders(),
      customFetchImpl: async (url, init) => auth.handler(new Request(url, init)),
    },
  });
  const result = await client.changeEmail({ newEmail: NEW_EMAIL, callbackURL: CALLBACK_URL });
  expect(result.error).toMatchObject({ code: "SESSION_EXPIRED", status: 400 });
  expect(sendEmail).not.toHaveBeenCalled();
});

it("refuses a revoked session before sending anything", async () => {
  memory.session.splice(0);
  expect((await requestChange()).status).toBe(401);
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each(["provider-error", "thrown"])("notice failure (%s) does not fail the request or log PII", async failure => {
  vi.mocked(sendEmail).mockResolvedValueOnce({ sent: true, id: "confirmation-id" });
  if (failure === "thrown") vi.mocked(sendEmail).mockRejectedValueOnce(new Error(`${OLD_EMAIL} ${NEW_EMAIL}`));
  else vi.mocked(sendEmail).mockResolvedValueOnce({ sent: false, reason: "provider-error" });
  expect((await requestChange()).status).toBe(200);
  expect(sendEmail).toHaveBeenCalledTimes(2);
  expect(mocks[failure === "thrown" ? "error" : "warn"]).toHaveBeenCalledWith(
    expect.objectContaining({ userId: USER_ID }), expect.any(String),
  );
  const logs = JSON.stringify([mocks.warn.mock.calls, mocks.error.mock.calls, mocks.info.mock.calls]);
  for (const pii of [OLD_EMAIL, NEW_EMAIL, "Private Name"]) expect(logs).not.toContain(pii);
});

it("assigns fresh provider keys even for repeated requests with the same token payload", async () => {
  await requestChange();
  await requestChange();
  const keys = vi.mocked(sendEmail).mock.calls.map(([input]) => input.idempotencyKey);
  expect(keys).toHaveLength(4);
  expect(keys.every(Boolean)).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);
});

it("logs local fallback links without recipient addresses", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "not-configured" });
  expect((await requestChange()).status).toBe(200);
  expect(log).toHaveBeenCalledWith(expect.stringContaining(`[auth:email-change-confirm] userId=${USER_ID} fullUrl=${ORIGIN}/api/auth/verify-email?`));
  expect(log).toHaveBeenCalledWith(`[auth:email-change-notice] appUrl=${ORIGIN}/forgot-password`);
  for (const email of [OLD_EMAIL, NEW_EMAIL]) expect(JSON.stringify(log.mock.calls)).not.toContain(email);
});

it("requires a valid server signature and matching new address before delivering mail", async () => {
  const send = auth.options.emailVerification.sendVerificationEmail;
  const user = { id: USER_ID, email: NEW_EMAIL, name: "Private Name", emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
  const payload = { email: OLD_EMAIL, updateTo: NEW_EMAIL, requestType: "change-email-verification" };
  const forged = await signJWT(payload, "untrusted-secret");
  await expect(send({ user, url: CALLBACK_URL, token: forged })).rejects.toThrow("Invalid email verification token.");
  const mismatch = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, OLD_EMAIL, "different@example.test", undefined, { requestType: "change-email-verification" });
  await expect(send({ user, url: CALLBACK_URL, token: mismatch })).rejects.toThrow("Invalid email verification token.");
  expect(sendEmail).not.toHaveBeenCalled();
});

function confirmationUrl(): URL {
  const confirmation = vi.mocked(sendEmail).mock.calls.find(([input]) => input.type === "email-change-confirm")![0];
  return new URL(confirmation.text.match(/http[^\s]+\/api\/auth\/verify-email\?[^\s]+/)![0]);
}

async function expectConfirmationRefused(url: URL, headers?: Headers, location = "/settings/profile?error=SIGN_IN_REQUIRED") {
  const sessionsBefore = memory.session.map(row => row.id);
  const usersBefore = memory.user.map(row => ({ ...row }));
  const response = await auth.handler(new Request(url, { headers }));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(location);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(memory.session.map(row => row.id)).toEqual(sessionsBefore);
  expect(memory.user).toEqual(usersBefore);
  expect(memory.user[0].email).toBe(OLD_EMAIL);
}

it("refuses a confirmation without a session and never creates a session or cookie", async () => {
  expect((await requestChange()).status).toBe(200);
  await expectConfirmationRefused(confirmationUrl());
});

it("refuses a confirmation signed in as another user without changing either account", async () => {
  expect((await requestChange()).status).toBe(200);
  memory.user.push({ ...memory.user[0], id: "other-user", email: "other@example.test" });
  memory.session.push({ ...memory.session[0], id: "other-session", userId: "other-user", token: "other-token" });
  await expectConfirmationRefused(confirmationUrl(), await sessionHeaders("other-token"), "/settings/profile?error=WRONG_ACCOUNT");
});

it("refuses an already-used link with INVALID_TOKEN and no cookie", async () => {
  await requestChange();
  const link = confirmationUrl();
  const response = await auth.handler(new Request(link, { headers: await sessionHeaders() }));
  expect(response.status).toBe(302);
  expect(memory.user[0].email).toBe(NEW_EMAIL);
  const sessionsBefore = memory.session.map(row => row.id);
  const replay = await auth.handler(new Request(link, { headers: await sessionHeaders() }));
  expect(replay.status).toBe(302);
  expect(replay.headers.get("location")).toBe("/settings/profile?error=INVALID_TOKEN");
  expect(replay.headers.get("set-cookie")).toBeNull();
  expect(memory.user[0].email).toBe(NEW_EMAIL);
  expect(memory.session.map(row => row.id)).toEqual(sessionsBefore);
});

it("password reset cancels a pending change even after a fresh sign-in", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const ctx = await auth.$context;
  memory.account[0].password = await ctx.password.hash("old-password-for-reset");
  memory.session.push({ ...memory.session[0], id: "second-session", token: "second-token" });
  expect((await requestChange()).status).toBe(200);
  const link = confirmationUrl();
  const oldHeaders = await sessionHeaders();
  // Include the signed snapshot too: revocation must defeat cookie caching.
  const sessionResponse = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: oldHeaders }));
  const cachedCookies = sessionResponse.headers.getSetCookie().map(cookie => cookie.split(";")[0]);
  expect(cachedCookies.some(cookie => cookie.startsWith(`${ctx.authCookies.sessionData.name}=`))).toBe(true);
  oldHeaders.set("cookie", [oldHeaders.get("cookie"), ...cachedCookies].join("; "));
  memory.verification.push({
    id: "reset-verification", identifier: "reset-password:reset-token", value: USER_ID,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS), createdAt: new Date(), updatedAt: new Date(),
  });
  vi.mocked(sendEmail).mockClear();
  const reset = await auth.handler(new Request(`${ORIGIN}/api/auth/reset-password`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ token: "reset-token", newPassword: "new-password-after-reset" }),
  }));
  expect(reset.status).toBe(200);
  expect(memory.session).toHaveLength(0);
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "password-changed", userId: USER_ID }));
  await expectConfirmationRefused(link, oldHeaders);
  vi.setSystemTime(Date.now() + MILLISECONDS_PER_SECOND);
  const signIn = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email: OLD_EMAIL, password: "new-password-after-reset" }),
  }));
  expect(signIn.status).toBe(200);
  expect(memory.session).toHaveLength(1);
  expect(memory.session[0].id).not.toBe("session-id");
  const freshHeaders = new Headers({ cookie: signIn.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ") });
  expect(freshHeaders.get("cookie")).toContain(ctx.authCookies.sessionToken.name);
  await expectConfirmationRefused(link, freshHeaders, "/settings/profile?error=INVALID_TOKEN");
});

it.each([
  ["/settings/profile?tab=email#email", "/settings/profile?tab=email&error=SIGN_IN_REQUIRED#email"],
  ["https://attacker.example/path", "/settings/profile?error=SIGN_IN_REQUIRED"],
  ["//attacker.example/path", "/settings/profile?error=SIGN_IN_REQUIRED"],
  ["/safe/..//attacker.example/path", "/settings/profile?error=SIGN_IN_REQUIRED"],
  ["/safe/%2e%2e//attacker.example/path", "/settings/profile?error=SIGN_IN_REQUIRED"],
  ["/\\attacker.example/path", "/settings/profile?error=SIGN_IN_REQUIRED"],
  ["/\t/attacker.example/path", "/settings/profile?error=SIGN_IN_REQUIRED"],
  [CALLBACK_URL, "/settings/profile?error=SIGN_IN_REQUIRED"],
])("refuses safely with callback %s", async (callback, location) => {
  await requestChange();
  const url = confirmationUrl();
  url.searchParams.set("callbackURL", callback);
  await expectConfirmationRefused(url, undefined, location);
});

it.each(["expired", "invalid"])("leaves %s tokens to Better Auth", async kind => {
  const token = kind === "expired"
    ? await signJWT({ email: OLD_EMAIL, updateTo: NEW_EMAIL, requestType: "change-email-verification" }, env.BETTER_AUTH_SECRET, -ONE_HOUR_SECONDS)
    : "not-a-signed-token";
  const url = new URL(`${ORIGIN}/api/auth/verify-email`);
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", "/settings/profile");
  const response = await auth.handler(new Request(url));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`/settings/profile?error=${kind === "expired" ? "TOKEN_EXPIRED" : "INVALID_TOKEN"}`);
  expect(memory.user[0].email).toBe(OLD_EMAIL);
});

it("runs the freshness before-hook for direct auth.api.changeEmail calls", async () => {
  const ctx = await auth.$context;
  memory.session[0].createdAt = new Date(Date.now() - ctx.sessionConfig.freshAge * MILLISECONDS_PER_SECOND);
  await expect(auth.api.changeEmail({
    body: { newEmail: NEW_EMAIL, callbackURL: "/settings/profile" }, headers: await sessionHeaders(),
  })).rejects.toMatchObject({ body: { code: "SESSION_EXPIRED" } });
  expect(sendEmail).not.toHaveBeenCalled();
  expect(memory.user[0].email).toBe(OLD_EMAIL);
});

it("configures the HTTP email change limit and password-reset revocation", () => {
  expect(auth.options.rateLimit.customRules["/change-email"]).toEqual({ window: 15 * 60, max: 5 });
  expect(auth.options.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
});
