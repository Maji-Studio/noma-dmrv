import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members, oauthAccessTokens, oauthClients, oauthConsents, oauthGrants } from "@/db/schema";
import { OAUTH_IDLE_LIMIT_MS, OAUTH_LAST_USED_THROTTLE_MS } from "@/config/oauth";
import { resolveApiContext } from "@/lib/auth/api-context";
import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { revokeGeneration } from "@/data-access/oauth-grant-lifecycle";
import { touchOAuthGeneration } from "@/data-access/oauth-credential-auth";
import { createOAuthFixture, type OAuthFixture } from "./helpers/oauth";

vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, OAUTH_PROVIDER_ENABLED: true } };
});
let f: OAuthFixture;
beforeEach(async () => { f = await createOAuthFixture(); });
afterEach(async () => { await f.cleanup(); });
it("resolves a Member, uses the generation identity, and intersects consent and grantable scopes", async () => {
  const a = await f.accessToken({ scopes: ["feedstocks:read", "feedstocks:write", "feedstocks:delete", "offline_access"], consentScopes: ["feedstocks:read", "feedstocks:delete"] });
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toMatchObject({ ok: true, ctx: { userId: f.userId, organizationId: f.orgIds[0], orgRole: "member", isPlatformAdmin: false,
    credentialId: a.grant.id, scopes: ["feedstocks:read"], principal: { kind: "oauth", oauthClientId: f.clientId }, credential: { kind: "oauth", id: a.grant.id, expiresAt: a.token.expiresAt } } });
});
it("applies narrowed consent to existing tokens immediately", async () => {
  const a = await f.accessToken();
  await db.update(oauthConsents).set({ scopes: ["feedstocks:read"] }).where(eq(oauthConsents.referenceId, a.grant.id));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toMatchObject({ ok: true, ctx: { scopes: ["feedstocks:read"] } });
});
it("refuses an unexpired token after inactivity without reviving the connection", async () => {
  const lastUsedAt = new Date(Date.now() - OAUTH_IDLE_LIMIT_MS);
  const a = await f.accessToken({ lastUsedAt });
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_expired" });
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_revoked" });
  expect(await db.query.oauthGrants.findFirst({ where: eq(oauthGrants.id, a.grant.id) })).toMatchObject({ lastUsedAt, revocationReason: "inactive" });
});
it.each(["rest", "mcp"] as const)("refuses %s tokens on the other audience", async source => {
  const config = getOAuthConfig();
  const a = await f.accessToken({ resource: config[source] });
  expect(await resolveApiContext(a.request(), config[source === "rest" ? "mcp" : "rest"])).toEqual({ ok: false, denial: "credential_audience_mismatch" });
});
it("checks confirmation before membership and membership before revocation", async () => {
  const a = await f.accessToken({ confirmation: { jkt: "synthetic" } });
  await revokeGeneration(a.grant.id, "disconnected");
  await db.delete(members).where(eq(members.id, f.memberIds[0]));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_invalid" });
  await db.update(oauthAccessTokens).set({ confirmation: null }).where(eq(oauthAccessTokens.id, a.token.id));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_owner_removed" });
});
it("refuses tokens missing a generation through the left join", async () => {
  const a = await f.accessToken();
  await db.update(oauthAccessTokens).set({ referenceId: null }).where(eq(oauthAccessTokens.id, a.token.id));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_invalid" });
});
it("refuses a disabled client, but token expiry takes precedence", async () => {
  const a = await f.accessToken();
  await db.update(oauthClients).set({ disabled: true }).where(eq(oauthClients.clientId, f.clientId));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_disabled" });
  await db.update(oauthAccessTokens).set({ expiresAt: new Date(0) }).where(eq(oauthAccessTokens.id, a.token.id));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_expired" });
});
it("purged and foreign-environment opaque tokens are invalid", async () => {
  const a = await f.accessToken();
  await db.delete(oauthAccessTokens).where(eq(oauthAccessTokens.id, a.token.id));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_invalid" });
});
it("throttles concurrent activity writes and never touches revoked generations", async () => {
  const a = await f.accessToken({ lastUsedAt: new Date(Date.now() - OAUTH_LAST_USED_THROTTLE_MS * 2) });
  const now = new Date();
  const updates = await Promise.all(Array.from({ length: 4 }, () => touchOAuthGeneration(a.grant.id, now)));
  expect(updates.flat()).toHaveLength(1);
  await revokeGeneration(a.grant.id, "disconnected");
  expect(await touchOAuthGeneration(a.grant.id, new Date(now.getTime() + OAUTH_LAST_USED_THROTTLE_MS * 2))).toEqual([]);
});

it.each(["revoked", "user", "consent", "resource", "resources"])("refuses invalid token state: %s", async kind => {
  const a = await f.accessToken();
  if (kind === "consent") await db.delete(oauthConsents).where(eq(oauthConsents.referenceId, a.grant.id));
  else await db.update(oauthAccessTokens).set(
    kind === "revoked" ? { revoked: new Date() } : kind === "user" ? { userId: f.actorId } :
      { resources: kind === "resource" ? [getOAuthConfig().mcp] : [getOAuthConfig().rest, getOAuthConfig().mcp] },
  ).where(eq(oauthAccessTokens.id, a.token.id));
  expect(await resolveApiContext(a.request(), getOAuthConfig().rest)).toEqual({ ok: false,
    denial: kind === "revoked" || kind === "consent" ? "credential_revoked" : kind === "user" ? "credential_invalid" : "credential_audience_mismatch" });
});
it("refuses a REST token at POST /api/mcp", async () => {
  const { POST } = await import("@/app/api/mcp/route");
  const a = await f.accessToken();
  const response = await POST(new Request(a.request("/api/mcp"), { method: "POST", headers: {
    ...Object.fromEntries(a.request().headers), "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: "credential_audience_mismatch" });
});
