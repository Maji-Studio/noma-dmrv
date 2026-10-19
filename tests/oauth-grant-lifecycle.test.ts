import { purgeExpiredOAuthAttempts, purgePendingOAuthGrants, purgeExpiredOAuthTokens, purgeExpiredOAuthClientAssertions } from "@/data-access/oauth-purge";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, organizationApiAccess, members, oauthClientAssertions, oauthAuthorizationAttempts, oauthAccessTokens, oauthRefreshTokens, oauthConsents, oauthGrants } from "@/db/schema";
import { selectOAuthOrganization, resolveAttemptGrant, revokeGeneration, getOAuthOrganizationSelection } from "@/data-access/oauth-grant-lifecycle";
import { createOAuthFixture, OAUTH_TEST_RESOURCE, OAUTH_TEST_DAY_MS, type OAuthFixture } from "./helpers/oauth";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
const BARRIER_CONNECTIONS = 2;
let f: OAuthFixture;
beforeEach(async () => { f = await createOAuthFixture(); });
afterEach(async () => { await f?.cleanup(); });

it("creates before consent and reuses one immutable generation across attempts", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const binding = { ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE };
  const grant = await resolveAttemptGrant(binding);
  expect(grant).toMatchObject({ organizationId: f.orgIds[0], userId: f.userId, memberId: f.memberIds[0], version: 1 });
  expect(grant.lastUsedAt).toEqual(grant.createdAt);
  expect((await resolveAttemptGrant(binding)).id).toBe(grant.id);
  const second = f.attempt();
  await selectOAuthOrganization(second);
  expect((await resolveAttemptGrant({ ...binding, ...second })).id).toBe(grant.id);
  await revokeGeneration(grant.id, "disconnected");
  await expect(resolveAttemptGrant(binding)).rejects.toMatchObject({ code: "forbidden" });
  const reconnect = f.attempt();
  await selectOAuthOrganization(reconnect);
  const next = await resolveAttemptGrant({ ...binding, ...reconnect });
  expect(next.id).not.toBe(grant.id);
  const [old] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.id));
  expect(old).toMatchObject({ revocationReason: "disconnected", version: 2 });
});

it("binds two tabs separately and refuses changed choices, sessions and expired attempts", async () => {
  const first = f.attempt();
  const second = f.attempt(f.orgIds[1]);
  await selectOAuthOrganization(first);
  await selectOAuthOrganization(second);
  const resolve = (attempt: typeof first) => resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  expect((await resolve(first)).organizationId).toBe(f.orgIds[0]);
  expect((await resolve(second)).organizationId).toBe(f.orgIds[1]);
  await expect(selectOAuthOrganization({ ...first, organizationId: f.orgIds[1] })).rejects.toMatchObject({ code: "forbidden" });
  await expect(resolve({ ...first, sessionId: randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
  await db.update(oauthAuthorizationAttempts).set({ expiresAt: new Date(0) }).where(eq(oauthAuthorizationAttempts.attemptKey, first.attemptKey));
  await expect(resolve(first)).rejects.toMatchObject({ code: "forbidden" });
});

it("replaces a generation after membership changes without rebinding old attempts", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const binding = { ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE };
  const original = await resolveAttemptGrant(binding);
  await f.consent(original.id);
  await db.delete(members).where(eq(members.id, f.memberIds[0]));
  await db.insert(members).values({ id: randomUUID(), userId: f.userId, organizationId: f.orgIds[0], role: "member" });
  await expect(resolveAttemptGrant(binding)).rejects.toMatchObject({ code: "forbidden" });
  const nextAttempt = f.attempt();
  await selectOAuthOrganization(nextAttempt);
  const next = await resolveAttemptGrant({ ...binding, ...nextAttempt });
  expect(next.id).not.toBe(original.id);
  const [old] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, original.id));
  expect(old.revocationReason).toBe("member_changed");
  expect(await db.select().from(oauthConsents).where(eq(oauthConsents.referenceId, original.id))).toEqual([]);
});

it("preselects consented connections without preventing a second organization", async () => {
  const input = { sessionId: f.sessionId, userId: f.userId, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE };
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...input, ...attempt });
  expect(await getOAuthOrganizationSelection(input)).toMatchObject({ autoSelectOrganizationId: null, preselectedOrganizationId: null });
  await f.consent(grant.id);
  expect(await getOAuthOrganizationSelection(input)).toMatchObject({ autoSelectOrganizationId: null, preselectedOrganizationId: f.orgIds[0] });
  const second = f.attempt(f.orgIds[1]);
  await selectOAuthOrganization(second);
  expect((await resolveAttemptGrant({ ...input, ...second })).organizationId).toBe(f.orgIds[1]);
  expect((await resolveAttemptGrant({ ...input, ...attempt })).id).toBe(grant.id);
  await db.delete(members).where(eq(members.id, f.memberIds[1]));
  expect(await getOAuthOrganizationSelection(input)).toMatchObject({ autoSelectOrganizationId: f.orgIds[0] });
});

it("serializes concurrent attempts into a single generation", async () => {
  const attempts = [f.attempt(), f.attempt()];
  for (const attempt of attempts) await selectOAuthOrganization(attempt);
  const grants = await Promise.all(attempts.map(attempt => resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE })));
  expect(grants[0].id).toBe(grants[1].id);
});

it("revokes consent atomically, preserves every plugin token field, and keeps the first reason", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  await f.consent(grant.id);
  const token = { clientId: f.clientId, userId: f.userId, sessionId: f.sessionId, referenceId: grant.id,
    scopes: ["feedstocks:read"], resources: [OAUTH_TEST_RESOURCE], createdAt: new Date(), expiresAt: new Date(Date.now() + OAUTH_TEST_DAY_MS) };
  const [refresh] = await db.insert(oauthRefreshTokens).values({ ...token, id: randomUUID(), token: createHash("sha256").update(randomUUID()).digest("hex") }).returning();
  const [access] = await db.insert(oauthAccessTokens).values({ ...token, id: randomUUID(), refreshId: refresh.id, token: createHash("sha256").update(randomUUID()).digest("hex") }).returning();
  await expect(db.transaction(async tx => { await revokeGeneration(grant.id, "disconnected", tx); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect(await db.select().from(oauthConsents).where(eq(oauthConsents.referenceId, grant.id))).toHaveLength(1);
  await revokeGeneration(grant.id, "disconnected");
  await revokeGeneration(grant.id, "refresh_reuse");
  expect(await db.select().from(oauthConsents).where(eq(oauthConsents.referenceId, grant.id))).toEqual([]);
  expect(await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, refresh.id))).toEqual([refresh]);
  expect(await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.id, access.id))).toEqual([access]);
  const [revoked] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grant.id));
  expect(revoked).toEqual({ ...grant, revokedAt: expect.any(Date), version: 2, revocationReason: "disconnected" });
});

it("purges only expired bookkeeping and old pending generations", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const pending = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  const second = f.attempt(f.orgIds[1]);
  await selectOAuthOrganization(second);
  const consented = await resolveAttemptGrant({ ...second, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  await f.consent(consented.id);
  const old = new Date(Date.now() - 2 * OAUTH_TEST_DAY_MS);
  await db.update(oauthGrants).set({ createdAt: old, lastUsedAt: old }).where(inArray(oauthGrants.id, [pending.id, consented.id]));
  await db.update(oauthAuthorizationAttempts).set({ expiresAt: new Date(0) }).where(eq(oauthAuthorizationAttempts.attemptKey, attempt.attemptKey));
  await purgeExpiredOAuthAttempts();
  expect(await db.select().from(oauthAuthorizationAttempts).where(eq(oauthAuthorizationAttempts.attemptKey, attempt.attemptKey))).toEqual([]);
  await purgePendingOAuthGrants();
  expect(await db.select().from(oauthGrants).where(eq(oauthGrants.id, pending.id))).toEqual([]);
  expect(await db.select().from(oauthGrants).where(eq(oauthGrants.id, consented.id))).toHaveLength(1);
  const expiredId = randomUUID(), liveId = randomUUID();
  await db.insert(oauthClientAssertions).values([{ id: expiredId, expiresAt: new Date(0) }, { id: liveId, expiresAt: new Date(Date.now() + OAUTH_TEST_DAY_MS) }]);
  try {
    await purgeExpiredOAuthClientAssertions();
    expect(await db.select().from(oauthClientAssertions).where(eq(oauthClientAssertions.id, expiredId))).toEqual([]);
    expect(await db.select().from(oauthClientAssertions).where(eq(oauthClientAssertions.id, liveId))).toHaveLength(1);
  } finally { await db.delete(oauthClientAssertions).where(inArray(oauthClientAssertions.id, [expiredId, liveId])); }
});

it("keeps unexpired access tokens even when their refresh token expires", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  const token = { clientId: f.clientId, userId: f.userId, referenceId: grant.id, scopes: ["feedstocks:read"], createdAt: new Date() };
  const [refresh] = await db.insert(oauthRefreshTokens).values({ ...token, id: randomUUID(), token: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(0) }).returning();
  const [access] = await db.insert(oauthAccessTokens).values({ ...token, id: randomUUID(), refreshId: refresh.id,
    token: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + OAUTH_TEST_DAY_MS) }).returning();
  await purgeExpiredOAuthTokens();
  expect(await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.id, access.id))).toEqual([access]);
  await db.update(oauthAccessTokens).set({ expiresAt: new Date(0) }).where(eq(oauthAccessTokens.id, access.id));
  await purgeExpiredOAuthTokens();
  expect(await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.id, access.id))).toEqual([]);
  expect(await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, refresh.id))).toEqual([]);
});

it.each(["unverified", "disabled", "missing-member", "expired-session"])("refuses authorization selection when %s", async state => {
  if (state === "unverified") await db.update(users).set({ emailVerified: false }).where(eq(users.id, f.userId));
  if (state === "disabled") await db.insert(organizationApiAccess).values({ organizationId: f.orgIds[0], enabled: false, changedByUserId: f.actorId });
  if (state === "missing-member") await db.delete(members).where(eq(members.id, f.memberIds[0]));
  if (state === "expired-session") await db.update(sessions).set({ expiresAt: new Date(0) }).where(eq(sessions.id, f.sessionId));
  await expect(selectOAuthOrganization(f.attempt())).rejects.toMatchObject({ code: "forbidden" });
});

it("does not refresh expiry on repeat selection or mutate the session's active organization", async () => {
  const attempt = f.attempt();
  const original = await selectOAuthOrganization(attempt);
  expect(await selectOAuthOrganization(attempt)).toEqual(original);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, f.sessionId));
  expect(session.activeOrganizationId).toBeNull();
});

it("keeps old pending generations referenced by fresh attempts and every non-stale category", async () => {
  const now = new Date();
  const old = new Date(now.getTime() - 2 * OAUTH_TEST_DAY_MS);
  const kinds = ["stale", "fresh-attempt", "young", "revoked", "access", "refresh"] as const;
  const grants = new Map<string, string>();
  for (const kind of kinds) {
    const [grant] = await db.insert(oauthGrants).values({ id: randomUUID(), organizationId: f.orgIds[0],
      userId: f.userId, memberId: f.memberIds[0], clientId: f.clientId, resource: `${OAUTH_TEST_RESOURCE}/${kind}`,
      createdAt: kind === "young" ? now : old, lastUsedAt: old,
      revokedAt: kind === "revoked" ? now : null }).returning();
    grants.set(kind, grant.id);
    if (kind === "fresh-attempt") {
      const attempt = f.attempt();
      await selectOAuthOrganization(attempt);
      expect((await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: grant.resource })).id).toBe(grant.id);
    }
    if (kind === "access" || kind === "refresh") {
      const table = kind === "access" ? oauthAccessTokens : oauthRefreshTokens;
      await db.insert(table).values({ id: randomUUID(), token: createHash("sha256").update(randomUUID()).digest("hex"),
        clientId: f.clientId, userId: f.userId, referenceId: grant.id, scopes: ["feedstocks:read"],
        createdAt: old, expiresAt: new Date(now.getTime() + OAUTH_TEST_DAY_MS) });
    }
  }
  await purgePendingOAuthGrants(now);
  const remaining = await db.select({ id: oauthGrants.id }).from(oauthGrants).where(inArray(oauthGrants.id, [...grants.values()]));
  expect(remaining.map(row => row.id).sort()).toEqual(kinds.filter(kind => kind !== "stale").map(kind => grants.get(kind)!).sort());
});

it.each(["clientId", "resource"] as const)("retains the attempt's %s binding even if its generation is deleted", async field => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const binding = { ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE };
  const grant = await resolveAttemptGrant(binding);
  const [stored] = await db.select().from(oauthAuthorizationAttempts).where(eq(oauthAuthorizationAttempts.attemptKey, attempt.attemptKey));
  expect(stored).toMatchObject({ clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  await expect(resolveAttemptGrant({ ...binding, [field]: `${binding[field]}/other` })).rejects.toMatchObject({ code: "forbidden" });
  await db.delete(oauthGrants).where(eq(oauthGrants.id, grant.id));
  await expect(resolveAttemptGrant({ ...binding, [field]: `${binding[field]}/other` })).rejects.toMatchObject({ code: "forbidden" });
});

it("refuses resolution when removal commits while the resolver waits on the attempt", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const pool = createTestPool(BARRIER_CONNECTIONS);
  const barrier = await openOperationBarrier(pool);
  let resolving: Promise<unknown> | undefined;
  try {
    await barrier.tx.select().from(oauthAuthorizationAttempts)
      .where(eq(oauthAuthorizationAttempts.attemptKey, attempt.attemptKey)).for("update");
    resolving = expect(resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE }))
      .rejects.toMatchObject({ code: "forbidden" });
    await waitForBlockedOperations(pool, barrier.pid, 1);
    await db.delete(members).where(eq(members.id, f.memberIds[0]));
    await barrier.commit();
    await resolving;
  } finally { await barrier.rollback(); await resolving; await pool.end(); }
});

it("resolves while another transaction holds a membership foreign-key lock", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const pool = createTestPool(BARRIER_CONNECTIONS);
  const barrier = await openOperationBarrier(pool);
  try {
    await barrier.tx.select().from(members).where(eq(members.id, f.memberIds[0])).for("key share");
    const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
    expect(grant.memberId).toBe(f.memberIds[0]);
  } finally { await barrier.rollback(); await pool.end(); }
});

it("replaces an idle generation for a fresh attempt and leaves old attempt bindings dead", async () => {
  const originalAttempt = f.attempt();
  await selectOAuthOrganization(originalAttempt);
  const binding = { ...originalAttempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE };
  const original = await resolveAttemptGrant(binding);
  await db.update(oauthGrants).set({ lastUsedAt: new Date(0) }).where(eq(oauthGrants.id, original.id));
  const freshAttempt = f.attempt();
  await selectOAuthOrganization(freshAttempt);
  const replacement = await resolveAttemptGrant({ ...binding, ...freshAttempt });
  expect(replacement.id).not.toBe(original.id);
  expect(await db.query.oauthGrants.findFirst({ where: eq(oauthGrants.id, original.id) })).toMatchObject({ revocationReason: "inactive" });
  await expect(resolveAttemptGrant(binding)).rejects.toMatchObject({ code: "forbidden" });
});
