/** Database contract: provider failure must never undo Platform Admin writes. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { invitations, organizations, users } from "@/db/schema";

vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(), requireOrgRole: vi.fn(), requirePlatformAdmin: vi.fn(),
}));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));

import { inviteMemberAction, createOrganizationAction } from "@/fn/organizations";
import { requireOrgContext, requirePlatformAdmin } from "@/lib/auth/server";
import { sendEmail } from "@/lib/email/send";

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
