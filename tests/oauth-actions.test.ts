import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthFlowFixture, type OAuthFlowFixture } from "./helpers/oauth-flow";
let actions: typeof import("@/fn/oauth");
const getOAuthConsentViewFn = (input: unknown) => actions.getOAuthConsentViewFn(input);
const getOAuthOrganizationChoicesFn = (input: unknown) => actions.getOAuthOrganizationChoicesFn(input);
const selectOAuthOrganizationFn = (input: unknown) => actions.selectOAuthOrganizationFn(input);
const listOAuthGrantsFn = () => actions.listOAuthGrantsFn();
const revokeOAuthGrantFn = (input: unknown) => actions.revokeOAuthGrantFn(input);
import { OAUTH_TEST_DAY_MS } from "./helpers/oauth";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
let f: OAuthFlowFixture;
beforeAll(async () => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true");
  vi.resetModules();
  actions = await import("@/fn/oauth");
});
beforeEach(async () => {
  f = await createOAuthFlowFixture();
  request.headers = f.headers;
  await f.db.update(f.tables.sessions).set({ activeOrganizationId: f.orgIds[0] }).where(eq(f.tables.sessions.id, f.sessionId));
});
afterEach(async () => { if (f) await f.cleanup(); });

async function ownGrant() {
  await f.connect();
  const result = await listOAuthGrantsFn();
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("Expected connected apps");
  return result.data.find(grant => grant.clientId === f.clientId)!;
}

describe("OAuth screen actions", () => {
  it("refuses tampered and expired signed queries", async () => {
    const flow = await f.authorize({ pick: false });
    const oauthQuery = flow.location.search.slice(1);
    expect((await getOAuthOrganizationChoicesFn({ oauthQuery })).success).toBe(true);
    expect((await getOAuthOrganizationChoicesFn({ oauthQuery: `${oauthQuery}&scope=orders:write` })).success).toBe(false);
    const expires = Number(flow.location.searchParams.get("exp")) * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(expires + 1);
      expect((await getOAuthOrganizationChoicesFn({ oauthQuery })).success).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("refuses an expired signed query returned to /login", async () => {
    const flow = await f.authorize({ query: { prompt: "login" }, pick: false });
    expect(flow.location.pathname).toBe("/login");
    const expires = Number(flow.location.searchParams.get("exp")) * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(expires + 1);
      const response = await f.request("/sign-in/email", { email: `${f.userId}@e2e.local`, password: "test-password",
        oauth_query: flow.location.search.slice(1) }, { cookie: "" });
      expect(response.ok).toBe(false);
      expect(await response.json()).toMatchObject({ error: "invalid_signature" });
    } finally { vi.useRealTimers(); }
  });

  it("can create the sign-in session before the OAuth after-hook refuses", async () => {
    const { hashPassword } = await import("better-auth/crypto");
    const password = "e2e-oauth-test-password";
    await f.db.insert(f.tables.accounts).values({ id: randomUUID(), userId: f.userId,
      accountId: f.userId, providerId: "credential", password: await hashPassword(password) });
    await f.db.delete(f.tables.members).where(eq(f.tables.members.id, f.memberIds[1]));
    const flow = await f.authorize({ scope: "offline_access", query: { prompt: "login" }, pick: false });
    expect(flow.location.pathname).toBe("/login");
    const before = await f.db.select({ id: f.tables.sessions.id }).from(f.tables.sessions).where(eq(f.tables.sessions.userId, f.userId));
    const response = await f.request("/sign-in/email", { email: `${f.userId}@e2e.local`, password,
      oauth_query: flow.location.search.slice(1) }, { cookie: "" });
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ error: "access_denied" });
    const after = await f.db.select({ id: f.tables.sessions.id }).from(f.tables.sessions).where(eq(f.tables.sessions.userId, f.userId));
    expect(after).toHaveLength(before.length + 1);
  });

  it("cannot read or change another session's bound attempt", async () => {
    const flow = await f.authorize();
    const oauthQuery = flow.location.search.slice(1);
    expect((await getOAuthConsentViewFn({ oauthQuery })).success).toBe(true);
    request.headers = f.adminHeaders;
    expect((await getOAuthConsentViewFn({ oauthQuery })).success).toBe(false);
    expect((await selectOAuthOrganizationFn({ oauthQuery, organizationId: f.orgIds[0] })).success).toBe(false);
  });

  it("shows the attempt organization despite a different active org and client-supplied fields", async () => {
    const flow = await f.authorize({ organizationIndex: 1 });
    expect(await getOAuthConsentViewFn({ oauthQuery: flow.location.search.slice(1), organizationId: f.orgIds[0], scopes: ["orders:write"] })).toMatchObject({ success: true, data: {
      organization: { id: f.orgIds[1] }, newlyRequestedScopes: ["feedstocks:read"], alreadyAllowedScopes: [], offlineAccessRequested: true, isStepUp: false,
    } });
  });

  it("uses the consent of the attempt generation for a step-up", async () => {
    await f.connect({ organizationIndex: 1 });
    const flow = await f.authorize({ organizationIndex: 1, scope: "feedstocks:read feedstocks:write offline_access" });
    expect(await getOAuthConsentViewFn({ oauthQuery: flow.location.search.slice(1) })).toMatchObject({ success: true, data: {
      organization: { id: f.orgIds[1] }, newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true,
    } });
  });

  it("resolves forced consent for an existing connection without calling it a step-up", async () => {
    await f.connect();
    const flow = await f.authorize({ query: { prompt: "consent" } });
    expect(flow.location.pathname).toBe("/oauth/consent");
    expect(await getOAuthConsentViewFn({ oauthQuery: flow.location.search.slice(1) })).toMatchObject({ success: true, data: {
      alreadyAllowedScopes: ["feedstocks:read"], newlyRequestedScopes: [], isStepUp: false,
    } });
    expect((await flow.consent()).hasCode).toBe(true);
  });

  it("refuses selection of an organization the user does not belong to", async () => {
    const flow = await f.authorize({ pick: false });
    await f.db.delete(f.tables.members).where(eq(f.tables.members.id, f.memberIds[1]));
    expect((await selectOAuthOrganizationFn({ oauthQuery: flow.location.search.slice(1), organizationId: f.orgIds[1] })).success).toBe(false);
  });

  it.each(["API disabled", "membership removed"])("refuses consent after selection when %s", async change => {
    const flow = await f.authorize();
    if (change === "API disabled") {
      await f.db.insert(f.tables.organizationApiAccess).values({ organizationId: f.orgIds[0], enabled: false, changedByUserId: f.actorId });
    } else {
      await f.db.delete(f.tables.members).where(eq(f.tables.members.id, f.memberIds[0]));
    }
    expect((await getOAuthConsentViewFn({ oauthQuery: flow.location.search.slice(1) })).success).toBe(false);
    await expect(flow.consent()).rejects.toMatchObject({ body: { error: "access_denied" } });
  });

  it("refuses Allow for a request containing only offline_access", async () => {
    const flow = await f.authorize({ scope: "offline_access", query: { prompt: "consent" } });
    expect(flow.location.pathname).toBe("/oauth/consent");
    expect((await getOAuthConsentViewFn({ oauthQuery: flow.location.search.slice(1) })).success).toBe(false);
    await expect(flow.consent()).rejects.toMatchObject({ body: { error: "access_denied" } });
  });

  it("lists disabled API memberships but refuses selection", async () => {
    const flow = await f.authorize({ pick: false });
    await f.db.insert(f.tables.organizationApiAccess).values({ organizationId: f.orgIds[1], enabled: false, changedByUserId: f.actorId });
    const oauthQuery = flow.location.search.slice(1);
    expect(await getOAuthOrganizationChoicesFn({ oauthQuery })).toMatchObject({ success: true, data: {
      memberships: expect.arrayContaining([expect.objectContaining({ organizationId: f.orgIds[1], disabledReason: expect.any(String) })]),
    } });
    expect((await selectOAuthOrganizationFn({ oauthQuery, organizationId: f.orgIds[1] })).success).toBe(false);
    const selected = await selectOAuthOrganizationFn({ oauthQuery, organizationId: f.orgIds[0] });
    expect(selected.success).toBe(true);
    if (!selected.success) throw new Error("Expected continuation");
    const continuation = await f.request("/oauth2/continue", selected.data);
    expect(continuation.status).toBe(200);
    // The plugin answers a relative URL; the browser navigates to it on our origin.
    expect(new URL((await continuation.json()).url, f.config.issuer).pathname).toBe("/oauth/consent");
  });

  it("Members see only their own grants; Admins see all and may revoke another's", async () => {
    const own = await ownGrant();
    const now = new Date();
    const [actorMember] = await f.db.select().from(f.tables.members).where(and(eq(f.tables.members.organizationId, f.orgIds[0]), eq(f.tables.members.userId, f.actorId)));
    await f.db.update(f.tables.users).set({ name: "E2E Other member" }).where(eq(f.tables.users.id, f.actorId));
    const otherId = randomUUID();
    await f.db.insert(f.tables.oauthGrants).values({ id: otherId, organizationId: f.orgIds[0], userId: f.actorId,
      memberId: actorMember.id, clientId: f.clientId, resource: f.config.mcp, createdAt: now, lastUsedAt: now });
    await f.db.insert(f.tables.oauthConsents).values({ id: randomUUID(), clientId: f.clientId, userId: f.actorId,
      referenceId: otherId, scopes: ["feedstocks:read"], resources: [f.config.mcp], createdAt: now, updatedAt: now });
    expect(await listOAuthGrantsFn()).toMatchObject({ success: true, data: [expect.objectContaining({ id: own.id })] });
    expect(await revokeOAuthGrantFn({ id: otherId, expectedVersion: 1 })).toMatchObject({ success: false, code: "forbidden" });
    await f.db.update(f.tables.members).set({ role: "admin" }).where(eq(f.tables.members.id, f.memberIds[0]));
    const all = await listOAuthGrantsFn();
    expect(all).toMatchObject({ success: true, data: expect.arrayContaining([expect.objectContaining({ id: own.id }), expect.objectContaining({ id: otherId, memberName: "E2E Other member" })]) });
    expect(await revokeOAuthGrantFn({ id: otherId, expectedVersion: 1 })).toEqual({ success: true, data: { id: otherId } });
  });

  it("returns the stale-version conflict and keeps the connection", async () => {
    const grant = await ownGrant();
    expect(await revokeOAuthGrantFn({ id: grant.id, expectedVersion: grant.version + 1 })).toMatchObject({ success: false, code: "stale_version", conflict: { entity: "oauth-grant", id: grant.id, code: "stale-version" } });
    expect(await listOAuthGrantsFn()).toMatchObject({ success: true, data: [expect.objectContaining({ id: grant.id })] });
  });

  it("session-derived attempt keys cannot reuse an existing choice", async () => {
    const flow = await f.authorize({ pick: false });
    const oauthQuery = flow.location.search.slice(1);
    expect((await selectOAuthOrganizationFn({ oauthQuery, organizationId: f.orgIds[0] })).success).toBe(true);
    expect((await selectOAuthOrganizationFn({ oauthQuery, organizationId: f.orgIds[1] })).success).toBe(false);
    // Replacing the authenticated session cannot expose the first attempt.
    await f.db.update(f.tables.sessions).set({ expiresAt: new Date(Date.now() - OAUTH_TEST_DAY_MS) }).where(eq(f.tables.sessions.id, f.sessionId));
    expect((await getOAuthConsentViewFn({ oauthQuery })).success).toBe(false);
  });
});
