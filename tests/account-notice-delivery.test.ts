/** Postgres contract: notices observe committed Platform Admin writes. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { members, organizations, users } from "@/db/schema";

vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/auth/server", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/auth/server")>()),
  requireOrgContext: vi.fn(),
}));
vi.mock("@/lib/auth/providers/better-auth-server", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/auth/providers/better-auth-server")>()),
  getBetterAuthSession: vi.fn(),
}));
vi.mock("@/lib/email/send", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()), sendEmail: vi.fn(),
}));
import { changeMemberRoleAction, removeMemberAction } from "@/fn/organizations";
import { requireOrgContext } from "@/lib/auth/server";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { sendEmail } from "@/lib/email/send";

let organizationId: string;
let actorId: string;
let userId: string;
let memberId: string;
let adminMemberId: string;
const ORGANIZATION_NAME = "Notice test organization";
const ACTOR_NAME = "Acting Platform Admin";

beforeEach(async () => {
  vi.clearAllMocks();
  organizationId = randomUUID();
  actorId = randomUUID();
  userId = randomUUID();
  memberId = randomUUID();
  adminMemberId = randomUUID();
  const orgAdminId = randomUUID();
  cleanupUserIds.push(orgAdminId);
  await db.insert(users).values([
    { id: orgAdminId, email: `${orgAdminId}@example.test`, name: "Org admin" },
    { id: actorId, email: `${actorId}@example.test`, name: ACTOR_NAME, role: "admin" },
    { id: userId, email: `${userId}@example.test`, name: "Recipient" },
  ]);
  await db.insert(organizations).values({ id: organizationId, name: ORGANIZATION_NAME, slug: `notice-${organizationId}` });
  // The Platform Admin deliberately has no membership. A separate Admin
  // keeps the last-Admin invariant intact across the recipient's role cycle.
  await db.insert(members).values([
    { id: memberId, userId, organizationId, role: "member" },
    { id: adminMemberId, userId: orgAdminId, organizationId, role: "admin" },
  ]);
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: actorId, organizationId, orgRole: null, isPlatformAdmin: true });
  vi.mocked(getBetterAuthSession).mockResolvedValue({ user: { id: actorId, name: ACTOR_NAME } } as never);
  vi.mocked(sendEmail).mockReset().mockResolvedValue({ sent: true, id: "message" });
});
const cleanupUserIds: string[] = [];
afterEach(async () => {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(inArray(users.id, [actorId, userId, ...cleanupUserIds]));
  cleanupUserIds.length = 0;
});

it("sends one role notice to the changed member after commit", async () => {
  let committedRole: string | undefined;
  vi.mocked(sendEmail).mockImplementation(async () => {
    // Observe through a separate connection; assert outside the delivery catch.
    const [stored] = await db.select().from(members).where(eq(members.id, memberId));
    committedRole = stored?.role;
    return { sent: true, id: "message" };
  });
  expect(await changeMemberRoleAction({ memberId, role: "admin" })).toMatchObject({ success: true });
  expect(committedRole).toBe("admin");
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "role-changed", to: `${userId}@example.test`,
    subject: `Your role in ${ORGANIZATION_NAME} is now Admin`, text: expect.stringContaining(ACTOR_NAME),
  }));
});
it("sends nothing for a same-role update", async () => {
  expect(await changeMemberRoleAction({ memberId, role: "member" })).toMatchObject({ success: true });
  expect(sendEmail).not.toHaveBeenCalled();
});
it("sends one removal notice after commit", async () => {
  let committedMemberCount: number | undefined;
  vi.mocked(sendEmail).mockImplementation(async () => {
    committedMemberCount = (await db.select().from(members).where(eq(members.id, memberId))).length;
    return { sent: true, id: "message" };
  });
  expect(await removeMemberAction({ memberIdOrEmail: memberId })).toMatchObject({ success: true });
  expect(committedMemberCount).toBe(0);
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "removed-from-organization", to: `${userId}@example.test`,
    subject: `You were removed from ${ORGANIZATION_NAME}`, text: expect.stringContaining(ACTOR_NAME),
  }));
});
it.each(["role", "remove"] as const)("preserves %s success on resolved and thrown provider failures", async path => {
  for (const thrown of [false, true]) {
    if (thrown) vi.mocked(sendEmail).mockRejectedValue(new Error("private@example.test"));
    else vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
    expect(path === "role"
      ? await changeMemberRoleAction({ memberId, role: thrown ? "member" : "admin" })
      : await removeMemberAction({ memberIdOrEmail: memberId })).toMatchObject({ success: true });
    const stored = await db.select().from(members).where(eq(members.id, memberId));
    expect(stored).toMatchObject(path === "role" ? [{ role: thrown ? "member" : "admin" }] : []);
    if (path === "remove" && !thrown) await db.insert(members).values({ id: memberId, userId, organizationId, role: "member" });
  }
});
it("uses distinct event keys for repeated real role changes", async () => {
  for (const role of ["admin", "member", "admin"] as const) {
    expect(await changeMemberRoleAction({ memberId, role })).toMatchObject({ success: true });
  }
  const keys = vi.mocked(sendEmail).mock.calls.map(([input]) => input.idempotencyKey);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(keys.length);
});
it("cannot notify or mutate a foreign membership", async () => {
  vi.mocked(requireOrgContext).mockResolvedValue({ userId: actorId, organizationId: randomUUID(), orgRole: null, isPlatformAdmin: true });
  expect(await changeMemberRoleAction({ memberId, role: "admin" })).toMatchObject({ success: false });
  expect(await removeMemberAction({ memberIdOrEmail: memberId })).toMatchObject({ success: false });
  expect(sendEmail).not.toHaveBeenCalled();
});
