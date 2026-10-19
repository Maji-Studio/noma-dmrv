import { createHash, createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";

const state = vi.hoisted(() => ({ attempt: undefined as undefined | { memberId: string; organizationId: string }, revoked: false, picker: false }));
vi.mock("@/config/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3100", BETTER_AUTH_SECRET: "unit-oauth-secret-at-least-32-characters" } }));
vi.mock("@/data-access/oauth-provider", () => ({ findOAuthOfflineGenerations: async () => [], findOAuthAttempt: async () => state.attempt, findOAuthClientResources: async () => [{ resource: "http://localhost:3100/api/mcp" }] }));
vi.mock("@/data-access/oauth-grant-lifecycle", () => ({
  getOAuthOrganizationSelection: async () => ({ memberships: [{ memberId: "member", organizationId: "org" }], autoSelectOrganizationId: state.picker ? null : "org" }),
  selectOAuthOrganization: async () => { state.attempt = { memberId: "member", organizationId: "org" }; },
  resolveAttemptGrant: async () => ({ id: "generation" }),
  revokeGeneration: async () => { state.revoked = true; },
}));
vi.mock("./oauth-eligibility", () => ({ assertGenerationEligible: async () => ({ ok: !state.revoked }) }));
import { createOAuthProvider } from "./oauth-provider";
import { oauthBefore } from "./oauth-hooks";

const SECRET = "unit-oauth-secret-at-least-32-characters";
const ORIGIN = "http://localhost:3100";
const RESOURCE = `${ORIGIN}/api/mcp`;
const REDIRECT = "https://example.test/callback";
beforeEach(() => { state.attempt = undefined; state.revoked = false; state.picker = false; });
async function fixture() {
  const now = new Date();
  const storage: Record<string, Record<string, unknown>[]> = {
    user: [{ id: "user", name: "E2E User", email: "user@e2e.local", emailVerified: true, createdAt: now, updatedAt: now }],
    session: [{ id: "session", token: "session-token", userId: "user", expiresAt: new Date(now.getTime() + 86_400_000), createdAt: now, updatedAt: now }],
    account: [], verification: [], oauthClient: [], oauthClientResource: [], oauthResource: [], oauthConsent: [], oauthRefreshToken: [], oauthAccessToken: [], oauthClientAssertion: [],
  };
  const auth = betterAuth({ baseURL: ORIGIN, secret: SECRET, database: memoryAdapter(storage),
    hooks: { before: createAuthMiddleware(ctx => oauthBefore(ctx)) }, plugins: [createOAuthProvider()], rateLimit: { enabled: false } });
  // The installed admin registration contradicts the spec; this independent
  // fixture seeds only memory so the remaining protocol can still be checked.
  const client = { client_id: "unit:client/with space" };
  storage.oauthClient.push({ id: "client", clientId: client.client_id, name: "E2E App", redirectUris: [REDIRECT],
    tokenEndpointAuthMethod: "none", requirePKCE: true, grantTypes: ["authorization_code", "refresh_token"],
    scopes: ["feedstocks:read", "offline_access"] });
  storage.oauthClientResource.push({ id: "link", clientId: client.client_id, resourceId: RESOURCE });
  const ctx = await auth.$context;
  const signed = `session-token.${createHmac("sha256", SECRET).update("session-token").digest("base64")}`;
  const headers = new Headers({ cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`, origin: ORIGIN });
  const verifier = "a".repeat(43);
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: REDIRECT, response_type: "code", scope: "feedstocks:read offline_access",
    resource: RESOURCE, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  const request = (path: string, body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => auth.handler(new Request(`${ORIGIN}/api/auth${path}`, { method: body ? "POST" : "GET",
    headers: body ? new Headers([...headers, ["content-type", "application/x-www-form-urlencoded"], ...Object.entries(extraHeaders)]) : headers, body: body ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])) : undefined }));
  return { auth, storage, client, headers, query, verifier, request };
}
it("reads provider state at authorize, consent and nested authorize without a cookie fallback", async () => {
  const f = await fixture();
  const response = await f.request(`/oauth2/authorize?${f.query}`);
  expect(response.status).toBe(302);
  const consentUrl = new URL(response.headers.get("location")!, ORIGIN);
  expect(consentUrl.pathname).toBe("/oauth/consent");
  const consent = await f.auth.api.oauth2Consent({ asResponse: false, headers: f.headers, request: new Request(`${ORIGIN}/api/auth/oauth2/consent`, { method: "POST", headers: f.headers }), body: { accept: true, oauth_query: consentUrl.search.slice(1) } });
  const redirect = new URL(consent.url);
  expect(redirect.searchParams.has("code")).toBe(true);
  const token = await f.request("/oauth2/token", { grant_type: "authorization_code", client_id: f.client.client_id,
    code: redirect.searchParams.get("code"), code_verifier: f.verifier, redirect_uri: REDIRECT, resource: RESOURCE });
  expect(token.status).toBe(200);
  expect(f.storage.oauthConsent[0].referenceId).toBe("generation");
  expect(f.storage.oauthAccessToken[0].referenceId).toBe("generation");
  expect(f.storage.oauthRefreshToken[0].referenceId).toBe("generation");
});
it("HTTP lockdown happens before endpoint schema validation", async () => {
  const f = await fixture();
  for (const endpoint of Object.values(f.auth.options.plugins[0].endpoints)) {
    if (!endpoint.path.startsWith("/oauth2/") || ["/oauth2/authorize", "/oauth2/token", "/oauth2/consent", "/oauth2/continue", "/oauth2/revoke"].includes(endpoint.path)) continue;
    const method = endpoint.options.method;
    expect((await f.request(endpoint.path, method === "GET" ? undefined : {})).status, endpoint.path).toBe(404);
  }
});

it("documents the installed admin registration conflict without relaxing privileges", async () => {
  const f = await fixture();
  await expect(f.auth.api.adminCreateOAuthClient({ body: { redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" } })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
});
it("refuses DPoP in a form authorization request", async () => {
  const f = await fixture();
  const body = Object.fromEntries(f.query); body.dpop_jkt = "unsupported";
  const response = await f.request("/oauth2/authorize", body);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("invalid_request");
});
it.each(["authorize", "token"])("refuses repeated form resources at %s", async endpoint => {
  const f = await fixture();
  const form = new URLSearchParams(f.query); form.append("resource", `${ORIGIN}/api/v1`);
  const response = await f.auth.handler(new Request(`${ORIGIN}/api/auth/oauth2/${endpoint}`, { method: "POST",
    headers: new Headers([...f.headers, ["content-type", "application/x-www-form-urlencoded"]]), body: form }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("invalid_target");
});

it("reads verified state again at continue before issuing consent", async () => {
  state.picker = true;
  const f = await fixture();
  const response = await f.request(`/oauth2/authorize?${f.query}`);
  const picker = new URL(response.headers.get("location")!, ORIGIN);
  expect(picker.pathname).toBe("/oauth/organization");
  state.attempt = { memberId: "member", organizationId: "org" };
  const result = await f.auth.api.oauth2Continue({ asResponse: false, headers: f.headers,
    request: new Request(`${ORIGIN}/api/auth/oauth2/continue`, { method: "POST", headers: f.headers }),
    body: { postLogin: true, oauth_query: picker.search.slice(1) } });
  expect(new URL(result.url, ORIGIN).pathname).toBe("/oauth/consent");
});
it("refuses a signed consent with no API scope", async () => {
  const f = await fixture();
  const response = await f.request(`/oauth2/authorize?${f.query}`);
  const url = new URL(response.headers.get("location")!, ORIGIN);
  await expect(f.auth.api.oauth2Consent({ headers: f.headers, body: { accept: true, scope: "offline_access", oauth_query: url.search.slice(1) } })).rejects.toMatchObject({ body: { error: "access_denied" } });
});
async function mint(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.request(`/oauth2/authorize?${f.query}`);
  const url = new URL(response.headers.get("location")!, ORIGIN);
  const consent = await f.auth.api.oauth2Consent({ asResponse: false, headers: f.headers,
    request: new Request(`${ORIGIN}/api/auth/oauth2/consent`, { method: "POST", headers: f.headers }),
    body: { accept: true, oauth_query: url.search.slice(1) } });
  const code = new URL(consent.url).searchParams.get("code");
  const responseToken = await f.request("/oauth2/token", { client_id: f.client.client_id, grant_type: "authorization_code", code,
    code_verifier: f.verifier, redirect_uri: REDIRECT, resource: RESOURCE });
  expect(responseToken.status).toBe(200);
  const data = await responseToken.json();
  return {
    refresh: () => f.request("/oauth2/token", { client_id: f.client.client_id, grant_type: "refresh_token", refresh_token: data.refresh_token }),
    revoke: (basic = false, clientId = f.client.client_id) => f.request("/oauth2/revoke",
      { ...(basic ? {} : { client_id: clientId }), token: data.refresh_token },
      basic ? { authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:fixture-secret`).toString("base64")}` } : {}),
  };
}
it("owns refresh reuse and never invokes the provider's family deletion", async () => {
  const f = await fixture(); const token = await mint(f);
  const adapter = (await f.auth.$context).adapter;
  const deletes = vi.spyOn(adapter, "deleteMany");
  const first = await token.refresh(); expect(first.status).toBe(200);
  const replay = await token.refresh(); expect(replay.status).toBe(200);
  const firstBody = await first.json(); const replayBody = await replay.json();
  expect(firstBody.refresh_token === replayBody.refresh_token).toBe(true);
  f.storage.oauthRefreshToken[0].rotatedAt = new Date(Date.now() - 31_000);
  const reused = await token.refresh();
  expect(reused.status).toBe(400); expect((await reused.json()).error).toBe("invalid_grant");
  expect(state.revoked).toBe(true);
  expect(deletes.mock.calls.filter(([input]) => input.model.startsWith("oauth"))).toHaveLength(0);
});
it("client revocation never changes plugin token rows", async () => {
  const f = await fixture(); const token = await mint(f);
  expect((await token.revoke()).status).toBe(200);
  expect((await token.revoke()).status).toBe(200);
  expect(state.revoked).toBe(true);
  expect(f.storage.oauthRefreshToken).toHaveLength(1);
  expect(f.storage.oauthAccessToken).toHaveLength(1);
  expect(f.storage.oauthRefreshToken[0].revoked).toBeFalsy();
  expect((await token.refresh()).status).toBe(400);
});
it("binds a missing resource to the single linked audience before signing consent", async () => {
  const f = await fixture(); f.query.delete("resource");
  const response = await f.request(`/oauth2/authorize?${f.query}`);
  const consent = new URL(response.headers.get("location")!, ORIGIN);
  expect(consent.pathname).toBe("/oauth/consent");
  expect(consent.searchParams.get("resource")).toBe(RESOURCE);
});
it("does not delegate reuse at the plugin's exact expiration boundary", async () => {
  const now = new Date(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  try {
    const f = await fixture(); const token = await mint(f); await token.refresh();
    f.storage.oauthRefreshToken[0].expiresAt = now;
    f.storage.oauthRefreshToken[0].rotatedAt = new Date(now.getTime() - 121_000);
    f.storage.oauthRefreshToken[0].rotationReplayExpiresAt = new Date(now.getTime() - 1000);
    const deletes = vi.spyOn((await f.auth.$context).adapter, "deleteMany");
    expect((await token.refresh()).status).toBe(400);
    expect(state.revoked).toBe(true);
    expect(deletes.mock.calls.filter(([input]) => input.model.startsWith("oauth"))).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});

it.each([false, true])("revokes the generation with body or URL-encoded Basic client identity (Basic: %s)", async basic => {
  const f = await fixture(); const token = await mint(f);
  expect((await token.revoke(basic)).status).toBe(200);
  expect(state.revoked).toBe(true);
  expect((await token.refresh()).status).toBe(400);
});
it.each([false, true])("does not revoke another client's generation (Basic: %s)", async basic => {
  const f = await fixture(); const token = await mint(f);
  expect((await token.revoke(basic, "other-client")).status).toBe(200);
  expect(state.revoked).toBe(false);
  expect((await token.refresh()).status).toBe(200);
});
