import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { members, organizations, users } from "@/db/schema";
import { removeMemberAsPlatformAdmin, updateMemberRoleAsPlatformAdmin } from "@/data-access/organizations";
import { LAST_ADMIN_MESSAGE } from "@/lib/auth/organization-role-policy";
import type { OrgContext } from "@/lib/auth/server";

let organizationIds: string[];
let userIds: string[];
let memberId: string;
let ctx: OrgContext;
beforeEach(async () => {
  organizationIds = [randomUUID(), randomUUID()];
  userIds = [randomUUID(), randomUUID()];
  memberId = randomUUID();
  await db.insert(organizations).values(organizationIds.map(id => ({ id, name: "Admin protection", slug: id })));
  await db.insert(users).values(userIds.map(id => ({ id, name: "Test", email: `${id}@example.test`, emailVerified: true })));
  await db.insert(members).values([
    { id: memberId, organizationId: organizationIds[0], userId: userIds[0], role: "admin" },
    { id: randomUUID(), organizationId: organizationIds[1], userId: userIds[1], role: "admin" },
  ]);
  ctx = { userId: userIds[0], organizationId: organizationIds[0], orgRole: null, isPlatformAdmin: true };
});
afterEach(async () => {
  await db.delete(organizations).where(inArray(organizations.id, organizationIds));
  await db.delete(users).where(inArray(users.id, userIds));
});
it.each(["demote", "remove"])("refuses last-Admin %s even with a Platform Admin override and an Admin in another org", async action => {
  await expect(action === "demote"
    ? updateMemberRoleAsPlatformAdmin(ctx, memberId, "member")
    : removeMemberAsPlatformAdmin(ctx, memberId)).rejects.toThrow(LAST_ADMIN_MESSAGE);
  const [member] = await db.select().from(members).where(eq(members.id, memberId));
  expect(member.role).toBe("admin");
});
it.each(["demote", "remove"])("allows %s when another Admin remains in the same org", async action => {
  await db.insert(members).values({ id: randomUUID(), organizationId: ctx.organizationId, userId: userIds[1], role: "admin" });
  if (action === "demote") await updateMemberRoleAsPlatformAdmin(ctx, memberId, "member");
  else await removeMemberAsPlatformAdmin(ctx, memberId);
  const rows = await db.select().from(members).where(eq(members.id, memberId));
  if (action === "demote") expect(rows[0].role).toBe("member");
  else expect(rows).toEqual([]);
});
it("serializes competing Platform Admin demotions so one Admin survives", async () => {
  const secondMemberId = randomUUID();
  await db.insert(members).values({ id: secondMemberId, organizationId: ctx.organizationId, userId: userIds[1], role: "admin" });
  const results = await Promise.allSettled([memberId, secondMemberId].map(id => updateMemberRoleAsPlatformAdmin(ctx, id, "member")));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
});
