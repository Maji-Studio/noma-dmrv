import { createHmac, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { members, organizations, sessions, users } from "@/db/schema";
import { isLastAdminDatabaseError, LAST_ADMIN_MESSAGE } from "@/lib/auth/organization-role-policy";

import { auth } from "@/lib/auth/better-auth";
import { changeMemberRoleAction } from "@/fn/organizations";
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
const SESSION_LIFETIME_MS = 60_000;

let organizationId: string;
let userIds: string[];
let memberIds: string[];
beforeEach(async () => {
  organizationId = randomUUID();
  userIds = [randomUUID(), randomUUID()];
  memberIds = [randomUUID(), randomUUID()];
  await db.insert(organizations).values({ id: organizationId, name: "Last Admin test", slug: organizationId });
  await db.insert(users).values(userIds.map(id => ({ id, name: "Test", email: `${id}@example.test` })));
  await db.insert(members).values(userIds.map((userId, index) => ({ id: memberIds[index], userId, organizationId, role: "admin" })));
});
afterEach(async () => {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(inArray(users.id, userIds));
});

it.each(["demote", "remove"] as const)("serializes concurrent self-%s writes and preserves one Admin", async operation => {
  // Hold the first transaction after its trigger fires, then start the other
  // writer while the organization lock is still held. No timing sleeps.
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const first = db.transaction(async tx => {
    if (operation === "demote") await tx.update(members).set({ role: "member" }).where(eq(members.id, memberIds[0]));
    else await tx.delete(members).where(eq(members.id, memberIds[0]));
    locked();
    await held;
  });
  // If the first writer fails, unblock the test rather than hang on the barrier.
  await Promise.race([ready, first]);
  let started!: () => void;
  const secondReady = new Promise<void>(resolve => { started = resolve; });
  const second = db.transaction(async tx => {
    const mutation = operation === "demote"
      ? tx.update(members).set({ role: "member" }).where(eq(members.id, memberIds[1])).execute()
      : tx.delete(members).where(eq(members.id, memberIds[1])).execute();
    started();
    return mutation;
  });
  const outcomes = Promise.allSettled([first, second]);
  try { await Promise.race([secondReady, second]); } finally { release(); }
  const results = await outcomes;
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const failure = results.find(result => result.status === "rejected");
  expect(failure?.status === "rejected" && isLastAdminDatabaseError(failure.reason)).toBe(true);
  expect(await db.select().from(members).where(and(eq(members.organizationId, organizationId), eq(members.role, "admin")))).toHaveLength(1);
});

it("refuses sequential last-Admin demotion and deletion", async () => {
  await db.delete(members).where(eq(members.id, memberIds[0]));
  for (const mutation of [
    () => db.update(members).set({ role: "member" }).where(eq(members.id, memberIds[1])),
    () => db.delete(members).where(eq(members.id, memberIds[1])),
  ]) {
    const error = await mutation().then(() => null, error => error);
    expect(isLastAdminDatabaseError(error)).toBe(true);
  }
});

it("allows whole-organization deletion to cascade through Admin memberships", async () => {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  expect(await db.select().from(members).where(eq(members.organizationId, organizationId))).toEqual([]);
});

it("allows changes to a fixture organization that has only Members", async () => {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.insert(organizations).values({ id: organizationId, name: "Members only", slug: organizationId });
  await db.insert(members).values(userIds.map((userId, index) => ({ id: memberIds[index], userId, organizationId, role: "member" })));
  await db.update(members).set({ role: "member" }).where(eq(members.id, memberIds[0]));
  await db.delete(members).where(eq(members.id, memberIds[1]));
  expect(await db.select().from(members).where(eq(members.organizationId, organizationId))).toHaveLength(1);
});

it("returns LAST_ADMIN_MESSAGE through real session auth and the server action", async () => {
  await db.delete(members).where(eq(members.id, memberIds[1]));
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, userIds[0]));
  const token = randomUUID();
  await db.insert(sessions).values({ id: randomUUID(), userId: userIds[0], token, activeOrganizationId: organizationId,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) });
  const context = await auth.$context;
  const signature = createHmac("sha256", context.secret).update(token).digest("base64");
  request.headers = new Headers({ cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}` });
  expect(await changeMemberRoleAction({ memberId: memberIds[0], role: "member" })).toEqual({ success: false, error: LAST_ADMIN_MESSAGE });
});
