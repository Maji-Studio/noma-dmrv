import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the real provider/helpers without opening a database connection.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter({ oauthResource: [] }) };
});

beforeEach(() => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true");
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", "https://claude.ai/client.json");
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

it("publishes authorization server metadata through the app route", async () => {
  const { GET } = await import("@/app/.well-known/oauth-authorization-server/api/auth/route");
  const response = await GET(new Request("http://localhost:3100/.well-known/oauth-authorization-server/api/auth"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const body = await response.json();
  expect(body).not.toHaveProperty("dpop_signing_alg_values_supported");
  expect(body).toMatchObject({
    issuer: "http://localhost:3100/api/auth",
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    grant_types_supported: ["authorization_code", "refresh_token"],
  });
  expect(body.token_endpoint_auth_methods_supported).toContain("none");
  const { OAUTH_GRANTABLE_SCOPES } = await import("@/lib/auth/oauth-scopes");
  expect(body.scopes_supported).toEqual([...OAUTH_GRANTABLE_SCOPES, "offline_access"]);
  expect(body).not.toHaveProperty("registration_endpoint");
  expect(body).not.toHaveProperty("jwks_uri");
});

const resourceRoutes = [
  { path: "/.well-known/oauth-protected-resource", audience: "/api/mcp", load: () => import("@/app/.well-known/oauth-protected-resource/route") },
  { path: "/.well-known/oauth-protected-resource/api/mcp", audience: "/api/mcp", load: () => import("@/app/.well-known/oauth-protected-resource/api/mcp/route") },
  { path: "/.well-known/oauth-protected-resource/api/v1", audience: "/api/v1", load: () => import("@/app/.well-known/oauth-protected-resource/api/v1/route") },
] as const;

it.each(resourceRoutes)("publishes the resource and scopes at $path", async ({ load, audience }) => {
  const response = await (await load()).GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const body = await response.json();
  expect(body).not.toHaveProperty("dpop_signing_alg_values_supported");
  expect(body).toMatchObject({
    resource: `http://localhost:3100${audience}`,
    authorization_servers: ["http://localhost:3100/api/auth"],
    bearer_methods_supported: ["header"],
  });
  const { OAUTH_GRANTABLE_SCOPES } = await import("@/lib/auth/oauth-scopes");
  expect(body.scopes_supported).toEqual([...OAUTH_GRANTABLE_SCOPES]);
  expect(body.scopes_supported).not.toContain("offline_access");
});

it.each(resourceRoutes.slice(1))("serves the exact challenge metadata URL at $path", async ({ load, audience, path }) => {
  const { apiDenialResponse, oauthInsufficientScopeChallenge } = await import("@/lib/api/problem");
  const { oauthResourceMetadataUrl } = await import("@/lib/auth/oauth-config");
  const resource = `http://localhost:3100${audience}`;
  const expected = `http://localhost:3100${path}`;
  expect(oauthResourceMetadataUrl(resource)).toBe(expected);
  expect(apiDenialResponse("credential_missing", audience, "request-id").headers.get("www-authenticate"))
    .toContain(`resource_metadata="${expected}"`);
  expect(oauthInsufficientScopeChallenge(resource, ["feedstocks:read"], ["feedstocks:write"]))
    .toContain(`resource_metadata="${expected}"`);
  expect((await (await (await load()).GET()).json()).resource).toBe(resource);
});

it("does not advertise CIMD when no client IDs are configured, but supports public clients", async () => {
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", "");
  const { GET } = await import("@/app/.well-known/oauth-authorization-server/api/auth/route");
  const body = await (await GET(new Request("http://localhost:3100/.well-known/oauth-authorization-server/api/auth"))).json();
  expect(body.client_id_metadata_document_supported).not.toBe(true);
  expect(body.token_endpoint_auth_methods_supported).toContain("none");
  const { auth } = await import("@/lib/auth/better-auth");
  expect(auth.options.plugins.some(plugin => plugin.id === "cimd")).toBe(false);
});

it("returns 404 for every discovery document with the provider off", async () => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "false");
  const { GET } = await import("@/app/.well-known/oauth-authorization-server/api/auth/route");
  expect((await GET(new Request("http://localhost:3100/.well-known/oauth-authorization-server/api/auth"))).status).toBe(404);
  for (const { load } of resourceRoutes) expect((await (await load()).GET()).status).toBe(404);
  const { auth } = await import("@/lib/auth/better-auth");
  expect(auth.options.plugins.some(plugin => ["oauth-provider", "cimd"].includes(plugin.id))).toBe(false);
});

it("keeps introspection closed over HTTP", async () => {
  const { auth } = await import("@/lib/auth/better-auth");
  const response = await auth.handler(new Request("http://localhost:3100/api/auth/oauth2/introspect", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "token=invalid",
  }));
  expect(response.status).toBe(404);
});

it("configures provider limits and the consent/continue custom rules", async () => {
  const { auth } = await import("@/lib/auth/better-auth");
  expect(auth.options.rateLimit?.customRules).toMatchObject({
    "/oauth2/consent": { window: 60, max: 120 }, "/oauth2/continue": { window: 60, max: 120 },
  });
  expect(auth.options.plugins.find(plugin => plugin.id === "oauth-provider")?.options).toMatchObject({
    dpop: { signingAlgorithms: [] },
    rateLimit: { token: { window: 60, max: 120 }, authorize: { window: 60, max: 120 }, revoke: { window: 60, max: 120 } },
  });
});
