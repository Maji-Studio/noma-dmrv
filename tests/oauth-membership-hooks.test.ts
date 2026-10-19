import { OAUTH_ROLE_POLICY } from "@/lib/auth/oauth-role-policy";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiKeyOwners, members, oauthGrants, sessions } from "@/db/schema";
import { env } from "@/config/env";
import { auth } from "@/lib/auth/better-auth";
import { removeMemberAsPlatformAdmin, updateMemberRoleAsPlatformAdmin } from "@/data-access/organizations";
import { resolveAttemptGrant, revokeMemberOAuthGrants, revokeDeletedMemberOAuthGrants, selectOAuthOrganization } from "@/data-access/oauth-grant-lifecycle";
import { createOAuthFixture, OAUTH_TEST_RESOURCE, OAUTH_TEST_DAY_MS, type OAuthFixture } from "./helpers/oauth";
let f: OAuthFixture;
beforeEach(async () => { f = await createOAuthFixture(); });
afterEach(async () => { await f?.cleanup(); });

async function headers(userId: string) {
  const token = randomUUID();
  await db.insert(sessions).values({ id: randomUUID(), userId, token, expiresAt: new Date(Date.now() + OAUTH_TEST_DAY_MS), activeOrganizationId: f.orgIds[0] });
  const signature = createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64");
  const context = await auth.$context;
  return new Headers({ cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}` });
}

it.each(["plugin", "platform", "leave", "direct"] as const)("removal through %s preserves the other organization and prevents old-attempt reuse", async path => {
  const attempts = f.orgIds.map(id => f.attempt(id));
  const grants = [];
  for (const attempt of attempts) {
    await selectOAuthOrganization(attempt);
    const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
    await f.consent(grant.id);
    grants.push(grant);
  }
  if (path === "plugin") await auth.api.removeMember({ headers: await headers(f.actorId), body: { memberIdOrEmail: f.memberIds[0], organizationId: f.orgIds[0] } });
  if (path === "platform") await removeMemberAsPlatformAdmin({ ...f.ctx, userId: f.actorId, isPlatformAdmin: true }, f.memberIds[0]);
  if (path === "leave") await auth.api.leaveOrganization({ headers: await headers(f.userId), body: { organizationId: f.orgIds[0] } });
  if (path === "direct") await db.delete(members).where(eq(members.id, f.memberIds[0]));
  const [removed] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grants[0].id));
  expect(removed.memberId).toBeNull();
  if (path === "direct") expect(removed.revokedAt).toBeNull();
  else expect(removed).toMatchObject({ revokedAt: expect.any(Date), revocationReason: "member_removed" });
  const [survivor] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grants[1].id));
  expect(survivor.revokedAt).toBeNull();
  await db.insert(members).values({ id: randomUUID(), userId: f.userId, organizationId: f.orgIds[0], role: "member" });
  await expect(resolveAttemptGrant({ ...attempts[0], clientId: f.clientId, resource: OAUTH_TEST_RESOURCE })).rejects.toMatchObject({ code: "forbidden" });
});

it("a refused last-owner leave does not revoke a connection", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  await db.update(members).set({ role: "owner" }).where(eq(members.id, f.memberIds[0]));
  await db.delete(members).where(eq(members.userId, f.actorId));
  await expect(auth.api.leaveOrganization({ headers: await headers(f.userId), body: { organizationId: f.orgIds[0] } })).rejects.toThrow();
  const [stored] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.id));
  expect(stored.revokedAt).toBeNull();
});

it("a leave result naming a live membership revokes nothing", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  await revokeDeletedMemberOAuthGrants({ id: f.memberIds[0], organizationId: f.orgIds[0], userId: f.userId });
  const [stored] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.id));
  expect(stored.revokedAt).toBeNull();
});

it.each(["plugin", "platform"] as const)("uses the shared connection role policy on %s demotion", async path => {
  await db.update(members).set({ role: "admin" }).where(eq(members.id, f.memberIds[0]));
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  const original = OAUTH_ROLE_POLICY.memberConnections;
  OAUTH_ROLE_POLICY.memberConnections = false;
  try {
    if (path === "plugin") await auth.api.updateMemberRole({ headers: await headers(f.actorId), body: { memberId: f.memberIds[0], organizationId: f.orgIds[0], role: "member" } });
    else await updateMemberRoleAsPlatformAdmin({ ...f.ctx, isPlatformAdmin: true }, f.memberIds[0], "member");
    const [stored] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.id));
    expect(stored.revokedAt).toBeInstanceOf(Date);
  } finally { OAUTH_ROLE_POLICY.memberConnections = original; }
});

it.each(["remove", "leave"] as const)("a delayed %s hook preserves a replacement membership's connection", async path => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const binding = { clientId: f.clientId, resource: OAUTH_TEST_RESOURCE };
  const original = await resolveAttemptGrant({ ...attempt, ...binding });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await db.delete(members).where(eq(members.id, f.memberIds[0]));
  const hook = barrier.then(() => path === "leave"
    ? revokeDeletedMemberOAuthGrants({ id: f.memberIds[0], organizationId: f.orgIds[0], userId: f.userId })
    : revokeMemberOAuthGrants(f.orgIds[0], f.userId, f.memberIds[0]));
  try {
    await db.insert(members).values({ id: randomUUID(), organizationId: f.orgIds[0], userId: f.userId, role: "member" });
    const nextAttempt = f.attempt();
    await selectOAuthOrganization(nextAttempt);
    const next = await resolveAttemptGrant({ ...nextAttempt, ...binding });
    release();
    await hook;
    expect((await resolveAttemptGrant({ ...nextAttempt, ...binding })).id).toBe(next.id);
    const [old] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, original.id));
    expect(old.revokedAt).toBeInstanceOf(Date);
  } finally { release(); await hook; }
});

it.each(["removed", "live", "last-owner"] as const)("leave disables API keys only after confirmed removal: %s", async state => {
  await db.update(members).set({ role: "owner" }).where(eq(members.id, f.memberIds[0]));
  const id = randomUUID();
  await db.insert(apiKeys).values({ id, referenceId: f.orgIds[0], key: createHash("sha256").update(randomUUID()).digest("hex") });
  await db.insert(apiKeyOwners).values({ credentialId: id, organizationId: f.orgIds[0], userId: f.userId, memberId: f.memberIds[0] });
  if (state === "live") {
    await revokeDeletedMemberOAuthGrants({ id: f.memberIds[0], organizationId: f.orgIds[0], userId: f.userId });
  } else if (state === "last-owner") {
    await db.delete(members).where(eq(members.userId, f.actorId));
    await expect(auth.api.leaveOrganization({ headers: await headers(f.userId), body: { organizationId: f.orgIds[0] } })).rejects.toThrow();
  } else {
    await auth.api.leaveOrganization({ headers: await headers(f.userId), body: { organizationId: f.orgIds[0] } });
  }
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
  const [owner] = await db.select().from(apiKeyOwners).where(eq(apiKeyOwners.credentialId, id));
  expect(key.enabled).toBe(state !== "removed");
  expect(owner.revokedAt).toEqual(state === "removed" ? expect.any(Date) : null);
});
