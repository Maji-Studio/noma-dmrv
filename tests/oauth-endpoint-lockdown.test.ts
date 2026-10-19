import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createOAuthFlowFixture, type OAuthFlowFixture } from "./helpers/oauth-flow";
let f: OAuthFlowFixture;
beforeAll(() => { vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true"); vi.resetModules(); });
afterEach(async () => { await f?.cleanup(); });
it("closes every runtime plugin endpoint outside the five permitted paths", async () => {
  f = await createOAuthFlowFixture();
  const plugin = f.auth.options.plugins.find(plugin => plugin.id === "oauth-provider")!;
  const allowed = new Set(["/oauth2/authorize", "/oauth2/token", "/oauth2/consent", "/oauth2/continue", "/oauth2/revoke"]);
  const endpoints = Object.values(plugin.endpoints ?? {});
  const adapter = (await f.auth.$context).adapter;
  const mutations = [vi.spyOn(adapter, "create"), vi.spyOn(adapter, "update"), vi.spyOn(adapter, "delete"),
    vi.spyOn(adapter, "deleteMany"), vi.spyOn(adapter, "incrementOne")];
  expect(endpoints.length).toBeGreaterThan(allowed.size);
  for (const endpoint of endpoints) {
    if (!endpoint.path?.startsWith("/oauth2/") || allowed.has(endpoint.path)) continue;
    const methods = Array.isArray(endpoint.options.method) ? endpoint.options.method : [endpoint.options.method];
    for (const method of methods) {
      if (method !== "GET" && method !== "POST") continue;
      const response = await f.request(endpoint.path, method === "POST" ? {} : undefined);
      expect(response.status, `${method} ${endpoint.path}`).toBe(404);
    }
  }
  expect((await f.request("/oauth2/future-endpoint")).status).toBe(404);
  for (const mutation of mutations) expect(mutation.mock.calls.length).toBe(0);
});
it("lets only a Platform Admin register a client, and only register", async () => {
  f = await createOAuthFlowFixture();
  const body = { client_name: "E2E OAuth refused", redirect_uris: ["https://example.test/refused"], token_endpoint_auth_method: "none" as const };
  // A signed-in non-admin is refused even through the server-only endpoint.
  await expect(f.auth.api.adminCreateOAuthClient({ headers: f.headers, body })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  // A Platform Admin may not change an existing client.
  await expect(f.auth.api.adminUpdateOAuthClient({ headers: f.adminHeaders, body: { client_id: f.clientId, update: { client_name: "E2E renamed" } } }))
    .rejects.toMatchObject({ status: "UNAUTHORIZED" });
  const { eq } = await import("drizzle-orm");
  expect(await f.db.select().from(f.tables.oauthClients).where(eq(f.tables.oauthClients.name, "E2E OAuth refused"))).toHaveLength(0);
  const [kept] = await f.db.select().from(f.tables.oauthClients).where(eq(f.tables.oauthClients.clientId, f.clientId));
  expect(kept.name).toBe("E2E OAuth flow");
});
it("permits Platform Admin server-side registration", async () => {
  f = await createOAuthFlowFixture();
  const { eq } = await import("drizzle-orm");
  const [client] = await f.db.select().from(f.tables.oauthClients).where(eq(f.tables.oauthClients.clientId, f.clientId));
  expect(client).toMatchObject({ tokenEndpointAuthMethod: "none", grantTypes: ["authorization_code", "refresh_token"] });
});
