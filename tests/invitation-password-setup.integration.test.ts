/** Database contract for mailbox-confirmed invitation setup. Requires Postgres. */
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, apiRateLimitBuckets, invitations, members, organizations, sessions, users, verifications } from "@/db/schema";
import { INVITATION_SET_PASSWORD_RESEND_COOLDOWN_SECONDS } from "@/config/auth";
import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { bootstrapInvitationAccountAction, resendInvitationSetPasswordAction } from "@/fn/invitation-bootstrap";
import { getInvitationBootstrapState } from "@/data-access/invitation-bootstrap";
import { auth } from "@/lib/auth/better-auth";
import { sendEmail } from "@/lib/email/send";

const cookieSet = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], set: cookieSet }),
}));
vi.mock("@/lib/email/send", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()), sendEmail: vi.fn(),
}));
const ORIGIN = "http://localhost:3100";
const PASSWORD = "invitation-mailbox-password";
const LIFETIME_MS = 60 * 60 * MILLISECONDS_PER_SECOND;
const CONCURRENT_RESEND_COUNT = 5;
let inviterId: string;
let organizationId: string;
let invitationId: string;
let email: string;
const createdUserIds: string[] = [];
const extraOrganizationIds: string[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(sendEmail).mockResolvedValue({ sent: true, id: "test-message" });
  inviterId = randomUUID(); organizationId = randomUUID(); invitationId = randomUUID();
  email = `invite-${invitationId}@example.test`;
  await db.insert(users).values({ id: inviterId, email: `${inviterId}@example.test`, name: "Inviter", emailVerified: true });
  await db.insert(organizations).values({ id: organizationId, name: "Invitation test", slug: organizationId });
  await db.insert(invitations).values({ id: invitationId, organizationId, inviterId, email, role: "member", status: "pending", expiresAt: new Date(Date.now() + LIFETIME_MS) });
});
afterEach(async () => {
  // Track by the unique fixture address even if a test stops before reading its user.
  const invitees = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const ids = [inviterId, ...createdUserIds, ...invitees.map(user => user.id)];
  await db.delete(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, ids.map(id => `invitation-set-password:${id}`)));
  await db.delete(verifications).where(inArray(verifications.value, ids));
  await db.delete(organizations).where(inArray(organizations.id, [organizationId, ...extraOrganizationIds.splice(0)]));
  await db.delete(users).where(inArray(users.id, ids));
  createdUserIds.length = 0;
});
async function bootstrap() {
  expect(await bootstrapInvitationAccountAction({ invitationId, name: "Invitee" }))
    .toEqual({ success: true, data: { emailSent: true } });
  const [user] = await db.select().from(users).where(eq(users.email, email));
  createdUserIds.push(user.id);
  return user;
}
async function signedHeaders(token: string) {
  const context = await auth.$context;
  const signature = createHmac("sha256", context.secret).update(token).digest("base64");
  return new Headers({ cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}` });
}

it("creates an unverified user with no credential, session or cookie from name only", async () => {
  const user = await bootstrap();
  expect(user.emailVerified).toBe(false);
  expect(await db.select().from(accounts).where(eq(accounts.userId, user.id))).toEqual([]);
  expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([]);
  expect(cookieSet).not.toHaveBeenCalled();
  expect(await getInvitationBootstrapState(invitationId)).toMatchObject({ account: "pending" });
  await expect(auth.api.signInEmail({ body: { email, password: PASSWORD } })).rejects.toThrow();
  const token = randomUUID();
  await db.insert(sessions).values({ id: randomUUID(), token, userId: user.id, expiresAt: new Date(Date.now() + LIFETIME_MS) });
  await expect(auth.api.acceptInvitation({ body: { invitationId }, headers: await signedHeaders(token) }))
    .rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION" } });
  expect(await db.select().from(members).where(eq(members.userId, user.id))).toEqual([]);
});

it("bootstrap and resend share one email per cooldown across invitations without changing the user", async () => {
  const user = await bootstrap();
  expect(await bootstrapInvitationAccountAction({ invitationId, name: "Ignored name" })).toMatchObject({ success: true });
  // One pending invitation per org and address, so the second comes from another org.
  const anotherInvitationId = randomUUID();
  const anotherOrganizationId = randomUUID();
  extraOrganizationIds.push(anotherOrganizationId);
  await db.insert(organizations).values({ id: anotherOrganizationId, name: "Second invitation test", slug: anotherOrganizationId });
  await db.insert(invitations).values({ id: anotherInvitationId, organizationId: anotherOrganizationId, inviterId, email, role: "member", status: "pending", expiresAt: new Date(Date.now() + LIFETIME_MS) });
  expect(await resendInvitationSetPasswordAction({ invitationId: anotherInvitationId })).toMatchObject({ success: true });
  expect(sendEmail).toHaveBeenCalledOnce();
  await db.update(apiRateLimitBuckets).set({ refilledAt: new Date(Date.now() - (INVITATION_SET_PASSWORD_RESEND_COOLDOWN_SECONDS + 1) * MILLISECONDS_PER_SECOND) }).where(eq(apiRateLimitBuckets.bucketKey, `invitation-set-password:${user.id}`));
  vi.mocked(sendEmail).mockClear();
  expect(await bootstrapInvitationAccountAction({ invitationId, name: "Another ignored name" })).toMatchObject({ success: true });
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(await db.select().from(users).where(eq(users.id, user.id))).toEqual([user]);
  vi.mocked(sendEmail).mockClear();
  expect(await resendInvitationSetPasswordAction({ invitationId })).toMatchObject({ success: true });
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each(["admin", "member"])("the invited mailbox sets a password and accepts as %s", async role => {
  await db.update(invitations).set({ role }).where(eq(invitations.id, invitationId));
  const user = await bootstrap();
  const message = vi.mocked(sendEmail).mock.calls[0]![0];
  expect(message.type).toBe("set-password");
  const link = message.text.match(/http:\/\/localhost:3100\/api\/auth\/reset-password\/[^\s]+/)![0];
  const response = await auth.handler(new Request(link));
  const destination = new URL(response.headers.get("location")!);
  expect(destination.origin).toBe(ORIGIN);
  expect(destination.pathname).toBe("/set-password");
  expect(destination.searchParams.get("invitation")).toBe(invitationId);
  const token = destination.searchParams.get("token")!;
  await auth.api.resetPassword({ body: { token, newPassword: PASSWORD } });
  expect(await getInvitationBootstrapState(invitationId)).toMatchObject({ account: "confirmed" });
  const signedIn = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  const accepted = await auth.api.acceptInvitation({ body: { invitationId }, headers: new Headers({ cookie: signedIn.headers.get("set-cookie")! }) });
  expect(accepted.member).toMatchObject({ userId: user.id, role, organizationId });
  await expect(auth.api.resetPassword({ body: { token, newPassword: PASSWORD } })).rejects.toThrow();
});

it("a confirmed invitee keeps their existing credential and accepts after sign-in", async () => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ email, name: "Existing invitee", emailVerified: true }, { method: "test" });
  createdUserIds.push(user.id);
  await context.internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: await context.password.hash(PASSWORD) });
  expect(await bootstrapInvitationAccountAction({ invitationId, name: "Ignored name" })).toEqual({ success: false, error: "An account already exists for this invitation. Sign in instead." });
  expect(sendEmail).not.toHaveBeenCalled();
  const signedIn = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  const accepted = await auth.api.acceptInvitation({ body: { invitationId }, headers: new Headers({ cookie: signedIn.headers.get("set-cookie")! }) });
  expect(accepted.member).toMatchObject({ role: "member", userId: user.id });
});

it("concurrent resends for a pending account send exactly one email", async () => {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ email, name: "Pending invitee", emailVerified: false }, { method: "test" });
  createdUserIds.push(user.id);
  const results = await Promise.all(Array.from({ length: CONCURRENT_RESEND_COUNT }, () =>
    resendInvitationSetPasswordAction({ invitationId })));
  expect(results).toEqual(Array.from({ length: CONCURRENT_RESEND_COUNT }, () => ({ success: true, data: { emailSent: true } })));
  expect(sendEmail).toHaveBeenCalledOnce();
});

it("a different pending user's bucket is not blocked by the first user's cooldown", async () => {
  await bootstrap();
  const anotherInvitationId = randomUUID();
  const anotherEmail = `invite-${anotherInvitationId}@example.test`;
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ email: anotherEmail, name: "Another pending invitee", emailVerified: false }, { method: "test" });
  createdUserIds.push(user.id);
  await db.insert(invitations).values({ id: anotherInvitationId, organizationId, inviterId, email: anotherEmail, role: "member", status: "pending", expiresAt: new Date(Date.now() + LIFETIME_MS) });
  expect(await resendInvitationSetPasswordAction({ invitationId })).toMatchObject({ success: true });
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(await resendInvitationSetPasswordAction({ invitationId: anotherInvitationId }))
    .toEqual({ success: true, data: { emailSent: true } });
  expect(sendEmail).toHaveBeenCalledTimes(2);
  expect(vi.mocked(sendEmail).mock.calls[1]![0]).toMatchObject({ type: "set-password", userId: user.id });
});
