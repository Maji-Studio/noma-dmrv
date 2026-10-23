/** Database contract: replacement is atomic; provider failure never undoes writes. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { invitations, members, organizations, users } from "@/db/schema";

vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/auth/server", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/auth/server")>()),
  requireOrgContext: vi.fn(), requireOrgRole: vi.fn(), requirePlatformAdmin: vi.fn(),
}));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("@/lib/auth/providers/better-auth-server", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/auth/providers/better-auth-server")>()),
  getBetterAuthSession: vi.fn(),
}));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmail: vi.fn(),
}));

import { inviteMemberAction, createOrganizationAction, resendInvitationAction } from "@/fn/organizations";
import { requireOrgContext, requirePlatformAdmin } from "@/lib/auth/server";
import { findPendingOrgInvitation, listOrgInvitations, replacePendingInvitation } from "@/data-access/organizations";
import { INVITATION_EXPIRES_IN_SECONDS, ORGANIZATION_INVITATION_LIMIT } from "@/config/auth";
import { sendEmail } from "@/lib/email/send";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";

const MILLISECONDS_PER_SECOND = 1_000;
const EXPIRY_OFFSET_MS = 60_000;

let adminId: string;
const organizationIds: string[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = randomUUID();
  await db.insert(users).values({ id: adminId, email: `${adminId}@example.test`, name: "Test", role: "admin" });
  vi.mocked(requirePlatformAdmin).mockResolvedValue({ id: adminId } as never);
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  vi.mocked(getBetterAuthSession).mockResolvedValue(null);
});
afterEach(async () => {
  if (organizationIds.length) await db.delete(organizations).where(inArray(organizations.id, organizationIds));
  await db.delete(users).where(eq(users.id, adminId));
  organizationIds.length = 0;
});

it("retains a pending Platform Admin override invitation on provider failure", async () => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: adminId, organizationId, orgRole: null, isPlatformAdmin: true });
  const result = await inviteMemberAction({ email: "invitee@example.test", role: "member" });
  expect(result).toMatchObject({ success: true, data: { emailSent: false } });
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(await db.select().from(invitations).where(eq(invitations.organizationId, organizationId)))
    .toMatchObject([{ status: "pending", email: "invitee@example.test", inviterId: adminId }]);
});

it("retains the new organization and first Admin invitation on provider failure", async () => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  const result = await createOrganizationAction({ name: "Test organization", adminEmail: "invitee@example.test" }, { intentKey: organizationId });
  expect(result).toMatchObject({ success: true, data: {
    organizationId, firstAdmin: { kind: "invited", emailSent: false },
  } });
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(await db.select().from(organizations).where(eq(organizations.id, organizationId))).toHaveLength(1);
  expect(await db.select().from(invitations).where(eq(invitations.organizationId, organizationId)))
    .toMatchObject([{ status: "pending", role: "admin", email: "invitee@example.test", inviterId: adminId }]);
});



it.each([
  { platform: false, sent: true }, { platform: false, sent: false },
  { platform: true, sent: true }, { platform: true, sent: false },
])("replaces an expired invitation atomically (platform=$platform, sent=$sent)", async ({ platform, sent }) => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  const ctx = { userId: adminId, organizationId, orgRole: platform ? null : "admin" as const, isPlatformAdmin: platform };
  if (!platform) await db.insert(members).values({ id: randomUUID(), organizationId, userId: adminId, role: "admin" });
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  const oldId = randomUUID();
  await db.insert(invitations).values({ id: oldId, organizationId, inviterId: adminId, email: "invitee@example.test",
    role: "admin", status: "pending", expiresAt: new Date(Date.now() - EXPIRY_OFFSET_MS) });
  vi.mocked(sendEmail).mockResolvedValue(sent ? { sent: true, id: "message" } : { sent: false, reason: "provider-error" });
  const now = Date.now();
  const result = await resendInvitationAction({ invitationId: oldId });
  expect(result).toMatchObject({ success: true, data: { emailSent: sent } });
  if (!result.success) throw new Error("Expected successful replacement");
  expect(result.data.invitationId).not.toBe(oldId);
  const stored = await db.select().from(invitations).where(eq(invitations.organizationId, organizationId));
  expect(stored.find(row => row.id === oldId)?.status).toBe("canceled");
  const fresh = stored.find(row => row.id === result.data.invitationId)!;
  expect(fresh).toMatchObject({ status: "pending", email: "invitee@example.test", role: "admin", inviterId: adminId });
  expect(fresh.expiresAt!.getTime()).toBeGreaterThanOrEqual(now + INVITATION_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND);
  expect(sendEmail).toHaveBeenCalledOnce();
});

it("names the admin who sends an invitation again", async () => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: adminId, organizationId, orgRole: null, isPlatformAdmin: true });
  vi.mocked(getBetterAuthSession).mockResolvedValue({ user: { name: "Amani Mushi" } } as never);
  const oldId = randomUUID();
  await db.insert(invitations).values({ id: oldId, organizationId, inviterId: adminId, email: "invitee@example.test",
    role: "member", status: "pending", expiresAt: new Date(Date.now() - EXPIRY_OFFSET_MS) });
  await resendInvitationAction({ invitationId: oldId });
  expect(vi.mocked(sendEmail).mock.calls[0]?.[0]).toMatchObject({ subject: "Amani Mushi invited you to Test" });
});

it("lists expired pending rows with server expiry and hides completed and foreign invitations", async () => {
  const [organizationId, otherId] = [randomUUID(), randomUUID()];
  organizationIds.push(organizationId, otherId);
  await db.insert(organizations).values([organizationId, otherId].map(id => ({ id, name: "Test", slug: `mail-${id}` })));
  const ctx = { userId: adminId, organizationId, orgRole: null, isPlatformAdmin: true };
  const expiredId = randomUUID();
  const pendingId = randomUUID();
  const foreignId = randomUUID();
  const canceledId = randomUUID();
  await db.insert(invitations).values([
    { id: expiredId, organizationId, status: "pending", expiresAt: new Date(Date.now() - EXPIRY_OFFSET_MS) },
    { id: pendingId, organizationId, status: "pending", expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) },
    { id: foreignId, organizationId: otherId, status: "pending", expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) },
    ...["accepted", "rejected", "canceled"].map(status => ({ id: status === "canceled" ? canceledId : randomUUID(), organizationId, status,
      expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) })),
  ].map((row, index) => ({ ...row, inviterId: adminId, email: `invitee-${index}@example.test`, role: "member" })));
  const listed = await listOrgInvitations(ctx);
  expect(listed).toHaveLength(2);
  expect(listed.find(row => row.id === expiredId)).toMatchObject({ expired: true, expiresAt: expect.any(Date) });
  expect(listed.find(row => row.id === pendingId)).toMatchObject({ expired: false });
  await expect(findPendingOrgInvitation(ctx, expiredId)).resolves.toMatchObject({ role: "member" });
  for (const id of [foreignId, canceledId, randomUUID()]) {
    await expect(findPendingOrgInvitation(ctx, id)).rejects.toThrow("Invitation not found or is no longer pending.");
  }
});


it.each([false, true])("rolls back cancellation when the replacement insert fails (platform=%s)", async platform => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  const oldId = randomUUID();
  await db.insert(invitations).values({ id: oldId, organizationId, inviterId: adminId, email: "invitee@example.test",
    role: "member", status: "pending", expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) });
  // A stale context whose inviter was deleted makes the actual INSERT fail its FK.
  const ctx = { userId: randomUUID(), organizationId, orgRole: platform ? null : "admin" as const, isPlatformAdmin: platform };
  await expect(replacePendingInvitation(ctx, { invitationId: oldId }))
    .rejects.toMatchObject({ cause: { code: "23503" } });
  expect(await db.select().from(invitations).where(eq(invitations.organizationId, organizationId)))
    .toMatchObject([{ id: oldId, status: "pending", inviterId: adminId }]);
  expect(sendEmail).not.toHaveBeenCalled();
});

it("allows only one concurrent replacement of the same pending row", async () => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  const ctx = { userId: adminId, organizationId, orgRole: "admin" as const, isPlatformAdmin: false };
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  const oldId = randomUUID();
  await db.insert(invitations).values({ id: oldId, organizationId, inviterId: adminId, email: "invitee@example.test",
    role: "member", status: "pending", expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) });
  const results = await Promise.all([resendInvitationAction({ invitationId: oldId }), resendInvitationAction({ invitationId: oldId })]);
  expect(results.filter(result => result.success)).toHaveLength(1);
  expect(results.find(result => !result.success)).toMatchObject({ error: "Invitation not found or is no longer pending." });
  const stored = await db.select().from(invitations).where(eq(invitations.organizationId, organizationId));
  expect(stored).toHaveLength(2);
  expect(stored.find(row => row.id === oldId)?.status).toBe("canceled");
  expect(stored.filter(row => row.status === "pending")).toHaveLength(1);
  expect(sendEmail).toHaveBeenCalledOnce();
});

it.each(["owner", "admin,member"])("keeps the old invitation pending when its stored role is %s", async role => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  const oldId = randomUUID();
  await db.insert(invitations).values({ id: oldId, organizationId, inviterId: adminId, email: "invitee@example.test",
    role, status: "pending", expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) });
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: adminId, organizationId, orgRole: "admin", isPlatformAdmin: false });
  expect(await resendInvitationAction({ invitationId: oldId })).toMatchObject({ success: false, error: "Choose Admin or Member." });
  expect(await db.select().from(invitations).where(eq(invitations.organizationId, organizationId)))
    .toMatchObject([{ id: oldId, role, status: "pending" }]);
  expect(sendEmail).not.toHaveBeenCalled();
});

it("refuses replacement after the recipient has become a member", async () => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  await db.insert(members).values({ id: randomUUID(), organizationId, userId: adminId, role: "admin" });
  const oldId = randomUUID();
  await db.insert(invitations).values({ id: oldId, organizationId, inviterId: adminId, email: `${adminId}@example.test`,
    role: "member", status: "pending", expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) });
  const ctx = { userId: adminId, organizationId, orgRole: null, isPlatformAdmin: true };
  await expect(replacePendingInvitation(ctx, { invitationId: oldId })).rejects.toThrow("User is already a member");
  expect(await db.select().from(invitations).where(eq(invitations.organizationId, organizationId)))
    .toMatchObject([{ id: oldId, status: "pending" }]);
});

it("preserves an expired invitation when refreshing it would exceed the active invitation limit", async () => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  const oldId = randomUUID();
  await db.insert(invitations).values([
    { id: oldId, organizationId, inviterId: adminId, email: "invitee@example.test", role: "member",
      status: "pending", expiresAt: new Date(Date.now() - EXPIRY_OFFSET_MS) },
    ...Array.from({ length: ORGANIZATION_INVITATION_LIMIT }, (_, index) => ({
      id: randomUUID(), organizationId, inviterId: adminId, email: `other-${index}@example.test`,
      role: "member", status: "pending", expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS),
    })),
  ]);
  const ctx = { userId: adminId, organizationId, orgRole: "admin" as const, isPlatformAdmin: false };
  await expect(replacePendingInvitation(ctx, { invitationId: oldId })).rejects.toThrow("Invitation limit reached.");
  const stored = await db.select().from(invitations).where(eq(invitations.organizationId, organizationId));
  expect(stored).toHaveLength(ORGANIZATION_INVITATION_LIMIT + 1);
  expect(stored.every(row => row.status === "pending")).toBe(true);
});

it.each(["other-org", "accepted", "rejected", "canceled"])("cannot replace a %s invitation", async state => {
  const [organizationId, otherId] = [randomUUID(), randomUUID()];
  organizationIds.push(organizationId, otherId);
  await db.insert(organizations).values([organizationId, otherId].map(id => ({ id, name: "Test", slug: `mail-${id}` })));
  const oldId = randomUUID();
  await db.insert(invitations).values({ id: oldId, organizationId: state === "other-org" ? otherId : organizationId,
    inviterId: adminId, email: "invitee@example.test", role: "member", status: state === "other-org" ? "pending" : state,
    expiresAt: new Date(Date.now() + EXPIRY_OFFSET_MS) });
  const ctx = { userId: adminId, organizationId, orgRole: "admin" as const, isPlatformAdmin: false };
  await expect(replacePendingInvitation(ctx, { invitationId: oldId })).rejects.toThrow("Invitation not found or is no longer pending.");
  expect(await db.select().from(invitations).where(eq(invitations.id, oldId)))
    .toMatchObject([{ status: state === "other-org" ? "pending" : state }]);
});
