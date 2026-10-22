/** Database contract: provider failure must never undo Platform Admin writes. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { invitations, organizations, users } from "@/db/schema";

vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/auth/server", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/auth/server")>()),
  requireOrgContext: vi.fn(), requireOrgRole: vi.fn(), requirePlatformAdmin: vi.fn(),
}));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmail: vi.fn(),
}));

import { inviteMemberAction, createOrganizationAction, resendInvitationAction } from "@/fn/organizations";
import { requireOrgContext, requirePlatformAdmin } from "@/lib/auth/server";
import { findPendingOrgInvitation, listOrgInvitations } from "@/data-access/organizations";
import { INVITATION_EXPIRES_IN_SECONDS } from "@/config/auth";
import { sendEmail } from "@/lib/email/send";

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



it.each([true, false])("replaces an expired Platform Admin invitation atomically with a new id (sent=%s)", async sent => {
  const organizationId = randomUUID();
  organizationIds.push(organizationId);
  await db.insert(organizations).values({ id: organizationId, name: "Test", slug: `mail-${organizationId}` });
  const ctx = { userId: adminId, organizationId, orgRole: null, isPlatformAdmin: true };
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
  expect(fresh).toMatchObject({ status: "pending", email: "invitee@example.test", role: "admin" });
  expect(fresh.expiresAt!.getTime()).toBeGreaterThanOrEqual(now + INVITATION_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND);
  expect(sendEmail).toHaveBeenCalledOnce();
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
  ].map(row => ({ ...row, inviterId: adminId, email: "invitee@example.test", role: "member" })));
  const listed = await listOrgInvitations(ctx);
  expect(listed).toHaveLength(2);
  expect(listed.find(row => row.id === expiredId)).toMatchObject({ expired: true, expiresAt: expect.any(Date) });
  expect(listed.find(row => row.id === pendingId)).toMatchObject({ expired: false });
  await expect(findPendingOrgInvitation(ctx, expiredId)).resolves.toMatchObject({ role: "member" });
  for (const id of [foreignId, canceledId, randomUUID()]) {
    await expect(findPendingOrgInvitation(ctx, id)).rejects.toThrow("Invitation not found or is no longer pending.");
  }
});
