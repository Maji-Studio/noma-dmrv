import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { createOAuthFlowFixture, type OAuthFlowFixture } from "./helpers/oauth-flow";
let f: OAuthFlowFixture;
beforeAll(() => { vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true"); vi.resetModules(); });
afterEach(async () => { await f?.cleanup(); });
it("issues a generation-bound code through nested consent and resolves the real token", async () => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize();
  expect(flow.location.pathname).toBe("/oauth/consent");
  const code = await flow.consent();
  expect(code.issuer).toBe(f.config.issuer);
  const token = await code.exchange();
  expect(token.status).toBe(200);
  expect(await token.resolve()).toMatchObject({ ok: true, ctx: { organizationId: f.orgIds[0], principal: { kind: "oauth" } } });
});

it.each([
  { code_challenge: null }, { code_challenge_method: "plain" },
  { redirect_uri: "https://example.test/callback/" }, { redirect_uri: "https://example.test/callback?extra=1" },
  { resource: "https://unknown.test" }, { dpop_jkt: "unsupported" },
])("refuses invalid authorization input %#", async query => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize({ query });
  expect(flow.code.hasCode).toBe(false);
  expect(flow.location.pathname).not.toBe("/oauth/consent");
});
it.each(["feedstocks:delete", "openid", "unknown"])("refuses scope %s", async scope => {
  f = await createOAuthFlowFixture();
  const result = await f.request(`/oauth2/authorize?client_id=${encodeURIComponent(f.clientId)}&scope=${scope}`);
  expect(result.status).toBe(400);
  expect((await result.json()).error).toBe("invalid_scope");
});
it("refuses a doubled resource", async () => {
  f = await createOAuthFlowFixture();
  expect((await f.request(`/oauth2/authorize?resource=${encodeURIComponent(f.config.mcp)}&resource=${encodeURIComponent(f.config.rest)}`)).status).toBe(400);
});
it("defaults a missing resource to the client's single linked audience", async () => {
  f = await createOAuthFlowFixture();
  const { and, eq } = await import("drizzle-orm");
  await f.db.delete(f.tables.oauthClientResources).where(and(eq(f.tables.oauthClientResources.clientId, f.clientId), eq(f.tables.oauthClientResources.resourceId, f.config.rest)));
  const flow = await f.authorize({ query: { resource: null } });
  const token = await (await flow.consent()).exchange({ resource: undefined });
  expect(token.status).toBe(200);
  expect(await token.resolve()).toMatchObject({ ok: true });
});
it.each(["verifier", "redirect", "expired", "reused"])("refuses %s code exchange", async reason => {
  f = await createOAuthFlowFixture();
  const code = await (await f.authorize()).consent();
  if (reason === "expired") {
    const { eq } = await import("drizzle-orm");
    // This fixture owns all verification values naming its user.
    const rows = await f.db.select().from(f.tables.verifications);
    for (const row of rows) {
      let value; try { value = JSON.parse(row.value); } catch { continue; }
      if (value.userId === f.userId) await f.db.update(f.tables.verifications).set({ expiresAt: new Date(0) }).where(eq(f.tables.verifications.id, row.id));
    }
  }
  if (reason === "reused") expect((await code.exchange()).status).toBe(200);
  const token = await code.exchange(reason === "verifier" ? { code_verifier: "wrong" } : reason === "redirect" ? { redirect_uri: "https://example.test/callback/" } : {});
  expect(token.status).toBe(400);
});
it("checks eligibility on a whitespace-padded authorization_code grant", async () => {
  f = await createOAuthFlowFixture();
  const code = await (await f.authorize()).consent();
  const { eq } = await import("drizzle-orm");
  await f.db.delete(f.tables.members).where(eq(f.tables.members.id, f.memberIds[0]));
  expect((await code.exchange({ grant_type: "authorization_code " })).status).toBe(400);
});
it("defaults a missing scope to the read set", async () => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize({ scope: "" });
  expect(flow.location.pathname).toBe("/oauth/consent");
  const requested = new URL(flow.location).searchParams.get("scope") ?? "";
  // The test client registers feedstocks:read, feedstocks:write and offline_access.
  expect(requested.split(" ").sort()).toEqual(["feedstocks:read", "offline_access"]);
});
it("a replayed code revokes the tokens already issued for it", async () => {
  f = await createOAuthFlowFixture();
  const code = await (await f.authorize()).consent();
  const first = await code.exchange();
  expect(first.status).toBe(200);
  expect((await code.exchange()).status).toBe(400);
  expect(await first.resolve()).toMatchObject({ ok: false });
  expect((await first.refresh()).error).toBe("invalid_grant");
});
it("narrows existing tokens and asks for consent again on escalation", async () => {
  f = await createOAuthFlowFixture();
  const original = await f.connect({ scope: "feedstocks:read feedstocks:write offline_access" });
  const narrowing = await f.authorize({ scope: "feedstocks:read feedstocks:write offline_access", query: { prompt: "consent" } });
  const readOnly = await (await narrowing.consent("feedstocks:read offline_access")).exchange();
  expect(readOnly.hasRefresh).toBe(true);
  const resolved = await original.resolve();
  expect(resolved.ok && resolved.ctx.scopes.includes("feedstocks:write")).toBe(false);
  const escalation = await f.authorize({ scope: "feedstocks:read feedstocks:write offline_access" });
  expect(escalation.location.pathname).toBe("/oauth/consent");
  expect(escalation.location.searchParams.get("scope")).toContain("feedstocks:write");
});
it("reconnecting never revives an old code", async () => {
  f = await createOAuthFlowFixture();
  const oldCode = await (await f.authorize()).consent();
  const { eq } = await import("drizzle-orm");
  const [grant] = await f.db.select().from(f.tables.oauthGrants).where(eq(f.tables.oauthGrants.clientId, f.clientId));
  const { revokeGeneration } = await import("@/data-access/oauth-grant-lifecycle");
  await revokeGeneration(grant.id, "disconnected");
  expect((await f.connect()).status).toBe(200);
  expect((await oldCode.exchange()).error).toBe("invalid_grant");
});
it.each(["removed", "unverified"])("refuses %s membership between authorization and consent", async reason => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize();
  const { eq } = await import("drizzle-orm");
  if (reason === "removed") await f.db.delete(f.tables.members).where(eq(f.tables.members.id, f.memberIds[0]));
  else await f.db.update(f.tables.users).set({ emailVerified: false }).where(eq(f.tables.users.id, f.userId));
  await expect(flow.consent()).rejects.toMatchObject({ body: { error: "access_denied" } });
});
it.each(["generation", "consent", "code"])("recovers after failure at %s without changing organization", async point => {
  f = await createOAuthFlowFixture();
  const adapter = (await f.auth.$context).adapter;
  const originalCreate = adapter.create.bind(adapter);
  let failed = false;
  const spy = vi.spyOn(adapter, "create").mockImplementation(async input => {
    if (!failed && ((point === "code" && input.model === "verification") || ((point === "generation" || point === "consent") && input.model === "oauthConsent"))) {
      failed = true;
      if (point === "consent") await originalCreate(input);
      throw new Error("Injected OAuth failure");
    }
    return originalCreate(input);
  });
  const flow = await f.authorize();
  await expect(flow.consent()).rejects.toThrow();
  spy.mockRestore();
  expect(failed).toBe(true);
  const recovered = await f.connect();
  expect(await recovered.resolve()).toMatchObject({ ok: true, ctx: { organizationId: f.orgIds[0] } });
});
it("concurrent first consents preserve one generation and retry successfully", async () => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize();
  const adapter = (await f.auth.$context).adapter;
  const findOne = adapter.findOne.bind(adapter);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const spy = vi.spyOn(adapter, "findOne").mockImplementation(async input => {
    const result = await findOne(input);
    if (input.model === "oauthConsent" && !result && ++reads <= 2) {
      if (reads === 2) release();
      await barrier;
    }
    return result;
  });
  const results = await Promise.allSettled([flow.consent(), flow.consent()]);
  spy.mockRestore();
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect((await f.connect()).status).toBe(200);
  const { eq } = await import("drizzle-orm");
  const grants = await f.db.select().from(f.tables.oauthGrants).where(eq(f.tables.oauthGrants.clientId, f.clientId));
  expect(grants).toHaveLength(1);
});
it("refuses consent with no API scope selected", async () => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize();
  await expect(flow.consent("offline_access")).rejects.toMatchObject({ body: { error: "access_denied" } });
});
it("returns issuer on a trusted-client authorization error", async () => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize({ query: { code_challenge_method: "plain" } });
  expect(flow.code.issuer).toBe(f.config.issuer);
  expect(flow.code.error).toBe("invalid_request");
});
