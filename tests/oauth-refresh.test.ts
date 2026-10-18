import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createOAuthFlowFixture, type OAuthFlowFixture } from "./helpers/oauth-flow";
let f: OAuthFlowFixture;
beforeAll(() => { vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true"); vi.resetModules(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await f?.cleanup(); });
function clock() { const now = new Date(Math.floor(Date.now() / 1000) * 1000); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); return now.getTime(); }
async function noFamilyDeletes() {
  const spy = vi.spyOn((await f.auth.$context).adapter, "deleteMany");
  return () => expect(spy.mock.calls.filter(([input]) => ["oauthAccessToken", "oauthRefreshToken"].includes(input.model))).toHaveLength(0);
}
async function generation() {
  const [grant] = await f.db.select().from(f.tables.oauthGrants).where(eq(f.tables.oauthGrants.clientId, f.clientId));
  return grant;
}
it("rotates and replays identical refreshes inside 30 seconds", async () => {
  f = await createOAuthFlowFixture(); const now = clock();
  const initial = await f.connect(); const assertNoDelete = await noFamilyDeletes();
  const rotated = await initial.refresh();
  expect(rotated.status).toBe(200); expect(initial.sameTokens(rotated)).toBe(false);
  vi.setSystemTime(now + 29_000);
  const replay = await initial.refresh();
  expect(replay.status).toBe(200); expect(rotated.sameTokens(replay)).toBe(true);
  expect((await generation()).revokedAt).toBeNull(); assertNoDelete();
});
it("reuse ends only one of four organization and audience generations", async () => {
  f = await createOAuthFlowFixture(); const now = clock();
  const tokens = [];
  for (const organizationIndex of [0, 1]) for (const resource of [f.config.mcp, f.config.rest]) tokens.push(await f.connect({ organizationIndex, resource }));
  const assertNoDelete = await noFamilyDeletes();
  const successor = await tokens[0].refresh();
  vi.setSystemTime(now + 31_000);
  expect((await tokens[0].refresh()).error).toBe("invalid_grant");
  expect(await successor.resolve()).toMatchObject({ ok: false, denial: "credential_revoked" });
  expect((await successor.refresh()).error).toBe("invalid_grant");
  for (const survivor of tokens.slice(1)) {
    expect(await survivor.resolve()).toMatchObject({ ok: true });
    expect((await survivor.refresh()).status).toBe(200);
  }
  assertNoDelete();
});
it.each([true, false])("client revoke replaces the plugin for refresh=%s, including repeat revocation", async refresh => {
  f = await createOAuthFlowFixture();
  const token = await f.connect(); const survivor = await f.connect({ organizationIndex: 1 });
  const assertNoDelete = await noFamilyDeletes();
  expect((await token.revoke(refresh)).status).toBe(200);
  expect((await token.revoke(refresh)).status).toBe(200);
  expect((await f.request("/oauth2/revoke", { token: "unknown" })).status).toBe(200);
  expect(await token.resolve()).toMatchObject({ ok: false, denial: "credential_revoked" });
  expect((await survivor.refresh()).status).toBe(200); assertNoDelete();
});
it.each(["removed", "disconnected", "unverified", "api-off", "idle"])("refuses refresh and code exchange after %s", async reason => {
  f = await createOAuthFlowFixture();
  const token = await f.connect(); const code = (await f.authorize()).code;
  const grant = await generation();
  if (reason === "removed") await f.db.delete(f.tables.members).where(eq(f.tables.members.id, f.memberIds[0]));
  if (reason === "unverified") await f.db.update(f.tables.users).set({ emailVerified: false }).where(eq(f.tables.users.id, f.userId));
  if (reason === "api-off") await f.db.insert(f.tables.organizationApiAccess).values({ organizationId: f.orgIds[0], enabled: false, changedByUserId: f.userId });
  if (reason === "idle") await f.db.update(f.tables.oauthGrants).set({ lastUsedAt: new Date(0) }).where(eq(f.tables.oauthGrants.id, grant.id));
  if (reason === "disconnected") { const { revokeGeneration } = await import("@/data-access/oauth-grant-lifecycle"); await revokeGeneration(grant.id, "disconnected"); }
  const assertNoDelete = await noFamilyDeletes();
  expect((await token.refresh()).error).toBe("invalid_grant");
  expect((await code.exchange()).error).toBe("invalid_grant"); assertNoDelete();
});
it("expired refresh leaves the generation intact", async () => {
  f = await createOAuthFlowFixture(); const token = await f.connect();
  await f.db.update(f.tables.oauthRefreshTokens).set({ expiresAt: new Date(0) }).where(eq(f.tables.oauthRefreshTokens.clientId, f.clientId));
  const assertNoDelete = await noFamilyDeletes();
  expect((await token.refresh()).error).toBe("invalid_grant");
  expect((await generation()).revokedAt).toBeNull(); assertNoDelete();
});
it("read-only consent retains offline access and refreshes after access expiry and browser sign-out", async () => {
  f = await createOAuthFlowFixture(); const now = clock();
  const flow = await f.authorize({ scope: "feedstocks:read feedstocks:write offline_access" });
  const token = await (await flow.consent("feedstocks:read offline_access")).exchange();
  expect(token.hasRefresh).toBe(true);
  await f.auth.api.signOut({ headers: f.headers });
  // Sign-out revokes the plugin's access tokens for that session; the
  // connection survives through its refresh token (spec 3.5).
  expect(await token.resolve()).toMatchObject({ ok: false, denial: "credential_revoked" });
  vi.setSystemTime(now + 3_601_000);
  const refreshed = await token.refresh();
  expect(refreshed.status).toBe(200);
  expect(await refreshed.resolve()).toMatchObject({ ok: true });
});
it("refuses client credentials and DPoP proofs", async () => {
  f = await createOAuthFlowFixture();
  const response = await f.request("/oauth2/token", { grant_type: "client_credentials", client_id: f.clientId });
  expect((await response.json()).error).toBe("unsupported_grant_type");
  const token = await f.connect();
  expect((await token.refresh({}, { DPoP: "unsupported" })).error).toBe("invalid_request");
});
it("two concurrent refreshes leave the generation active", async () => {
  f = await createOAuthFlowFixture(); const token = await f.connect();
  const assertNoDelete = await noFamilyDeletes();
  const results = await Promise.all([token.refresh(), token.refresh()]);
  expect(results.some(result => result.status === 200)).toBe(true);
  expect(results.every(result => result.status === 200 || result.error === "invalid_grant")).toBe(true);
  expect((await generation()).revokedAt).toBeNull(); assertNoDelete();
});
it.each(["rotated", "unrotated"] as const)("protects the hook-to-handler margin when the hook saw %s", async state => {
  f = await createOAuthFlowFixture(); const now = clock();
  const token = await f.connect();
  if (state === "rotated") { await token.refresh(); vi.setSystemTime(now + 29_000); }
  const adapter = (await f.auth.$context).adapter;
  const original = adapter.findOne.bind(adapter);
  let entered!: () => void; let release!: () => void;
  const atHandler = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const spy = vi.spyOn(adapter, "findOne").mockImplementation(async input => {
    if (input.model === "oauthRefreshToken" && ++reads === 2) { entered(); await barrier; }
    return original(input);
  });
  const assertNoDelete = await noFamilyDeletes();
  const pending = token.refresh();
  try {
    await atHandler;
    // The second request rotates after the first passed its read-only hook.
    if (state === "unrotated") { spy.mockRestore(); expect((await token.refresh()).status).toBe(200); }
    vi.setSystemTime(now + (state === "rotated" ? 100_000 : 119_000));
    release(); await pending;
    expect((await generation()).revokedAt).toBeNull(); assertNoDelete();
  } finally { release(); await pending; spy.mockRestore(); }
});
it("a successor minted across reuse is dead on its first use", async () => {
  f = await createOAuthFlowFixture(); const now = clock();
  const token = await f.connect(); const adapter = (await f.auth.$context).adapter;
  const original = adapter.incrementOne.bind(adapter);
  let entered!: () => void; let release!: () => void;
  const rotated = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const spy = vi.spyOn(adapter, "incrementOne").mockImplementation(async input => {
    const result = await original(input);
    if (input.model === "oauthRefreshToken") { entered(); await barrier; }
    return result;
  });
  const assertNoDelete = await noFamilyDeletes(); const pending = token.refresh();
  try {
    await rotated; vi.setSystemTime(now + 31_000);
    expect((await token.refresh()).error).toBe("invalid_grant");
    release(); const successor = await pending;
    expect(successor.status).toBe(200);
    expect(await successor.resolve()).toMatchObject({ ok: false, denial: "credential_revoked" });
    expect((await successor.refresh()).error).toBe("invalid_grant"); assertNoDelete();
  } finally { release(); await pending; spy.mockRestore(); }
});
it.each(["refresh_token ", "\trefresh_token", " refresh_token\n"])("judges reuse on the trimmed grant type %j", async grantType => {
  f = await createOAuthFlowFixture(); const now = clock();
  const token = await f.connect(); const assertNoDelete = await noFamilyDeletes();
  expect((await token.refresh()).status).toBe(200);
  vi.setSystemTime(now + 121_000);
  expect((await token.refresh({ grant_type: grantType })).error).toBe("invalid_grant");
  expect((await generation()).revocationReason).toBe("refresh_reuse");
  assertNoDelete();
});
it("refuses unknown grant types before the plugin", async () => {
  f = await createOAuthFlowFixture();
  const token = await f.connect();
  expect((await token.refresh({ grant_type: "password" })).error).toBe("unsupported_grant_type");
});
it("the patched plugin refuses a family teardown instead of deleting", async () => {
  f = await createOAuthFlowFixture(); const now = clock();
  const token = await f.connect(); const assertNoDelete = await noFamilyDeletes();
  expect((await token.refresh()).status).toBe(200);
  // Bypass our hook's reuse decision to reach the plugin's teardown branch.
  const policy = await import("@/lib/auth/oauth-request-policy");
  vi.spyOn(policy, "refreshDecision").mockReturnValue("pass");
  vi.setSystemTime(now + 121_000);
  expect((await token.refresh()).error).toBe("invalid_grant");
  assertNoDelete();
});
it("exports the token request deadline as a literal equal to the config", async () => {
  const { maxDuration } = await import("@/app/api/auth/[...all]/route");
  const { OAUTH_TOKEN_DEADLINE_SECONDS } = await import("@/config/oauth");
  expect(maxDuration).toBe(OAUTH_TOKEN_DEADLINE_SECONDS);
});
it("refuses a refresh that drops offline_access, so logout never revokes a refresh row", async () => {
  f = await createOAuthFlowFixture();
  const token = await f.connect();
  const assertNoDelete = await noFamilyDeletes();
  expect((await token.refresh({ scope: "feedstocks:read" })).error).toBe("invalid_scope");
  const other = await f.connect({ organizationIndex: 1 });
  await f.auth.api.signOut({ headers: f.headers });
  const refreshRows = await f.db.select().from(f.tables.oauthRefreshTokens).where(eq(f.tables.oauthRefreshTokens.clientId, f.clientId));
  expect(refreshRows.length).toBeGreaterThan(0);
  for (const row of refreshRows) expect(row.revoked).toBeNull();
  expect((await token.refresh()).status).toBe(200);
  expect((await other.refresh()).status).toBe(200);
  assertNoDelete();
});
it("refuses a refresh row that lacks offline_access without reaching the plugin", async () => {
  f = await createOAuthFlowFixture();
  const token = await f.connect();
  await f.db.update(f.tables.oauthRefreshTokens).set({ scopes: ["feedstocks:read"] }).where(eq(f.tables.oauthRefreshTokens.clientId, f.clientId));
  const assertNoDelete = await noFamilyDeletes();
  expect((await token.refresh()).error).toBe("invalid_grant");
  assertNoDelete();
});
