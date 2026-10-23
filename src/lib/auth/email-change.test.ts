/** Exercise email changes through the real auth config with an in-memory store. */
import { createHmac } from "node:crypto";
import { createEmailVerificationToken } from "better-auth/api";
import { createAuthClient } from "better-auth/client";
import { signJWT } from "better-auth/crypto";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
const memory = vi.hoisted(() => ({
  user: [] as Record<string, unknown>[],
  session: [] as Record<string, unknown>[],
  account: [] as Record<string, unknown>[],
  verification: [] as Record<string, unknown>[],
}));
vi.mock("@/db", () => ({ db: {} }));
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

async function sessionHeaders() {
  const ctx = await auth.$context;
  const signature = createHmac("sha256", ctx.secret).update(SESSION_TOKEN).digest("base64");
  return new Headers({
    origin: ORIGIN, "content-type": "application/json",
    cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${SESSION_TOKEN}.${signature}`)}`,
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
