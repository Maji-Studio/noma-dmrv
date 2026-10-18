import { createHash, createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";

export async function createOAuthFlowFixture() {
  const { auth } = await import("@/lib/auth/better-auth");
  const { db } = await import("@/db");
  const tables = await import("@/db/schema");
  const { env } = await import("@/config/env");
  const { getOAuthConfig } = await import("@/lib/auth/oauth-config");
  const { oauthAttemptKey } = await import("@/lib/auth/oauth-attempt");
  const { selectOAuthOrganization } = await import("@/data-access/oauth-grant-lifecycle");
  const { verifyOAuthQueryParams } = await import("@better-auth/oauth-provider");
  const { createOAuthFixture, OAUTH_TEST_DAY_MS } = await import("./oauth");
  const f = await createOAuthFixture();
  const config = getOAuthConfig();
  const redirectUri = "https://example.test/callback";
  const context = await auth.$context;
  const sessionHeaders = (token: string) => new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64")}`)}`,
    origin: env.NEXT_PUBLIC_APP_URL,
  });
  // Only a Platform Admin may register a client (clientPrivileges); the fixture's
  // Owner actor is promoted for registration and removed with the fixture.
  await db.update(tables.users).set({ role: "admin" }).where(eq(tables.users.id, f.actorId));
  const adminToken = randomBytes(32).toString("hex");
  await db.insert(tables.sessions).values({ id: randomBytes(16).toString("hex"), userId: f.actorId, token: adminToken, expiresAt: new Date(Date.now() + OAUTH_TEST_DAY_MS) });
  const client = await auth.api.adminCreateOAuthClient({ headers: sessionHeaders(adminToken), body: {
    client_name: "E2E OAuth flow", redirect_uris: [redirectUri], token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    scope: "feedstocks:read feedstocks:write offline_access", resources: [config.mcp, config.rest],
  } });
  const clientId = client.client_id;
  const [session] = await db.select().from(tables.sessions).where(eq(tables.sessions.id, f.sessionId));
  const headers = sessionHeaders(session.token);

  async function request(path: string, body?: Record<string, unknown>, extraHeaders?: HeadersInit) {
    const h = new Headers(headers);
    new Headers(extraHeaders).forEach((value, name) => h.set(name, value));
    const form = body && ["/oauth2/token", "/oauth2/revoke"].includes(path);
    if (body) h.set("content-type", form ? "application/x-www-form-urlencoded" : "application/json");
    return auth.handler(new Request(`${config.issuer}${path}`, { method: body ? "POST" : "GET", headers: h, body: body ? (form ? new URLSearchParams(Object.entries(body).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])) : JSON.stringify(body)) : undefined }));
  }
  async function tokens(response: Response, resource: string) {
    const data = await response.json();
    return {
      status: response.status, error: data.error as string | undefined, scope: data.scope as string | undefined,
      hasRefresh: typeof data.refresh_token === "string",
      async resolve() {
        const { resolveApiContext } = await import("@/lib/auth/api-context");
        return resolveApiContext(new Request(resource, { headers: { authorization: `Bearer ${data.access_token}` } }), resource);
      },
      async refresh(extra: Record<string, unknown> = {}, extraHeaders?: HeadersInit) {
        return tokens(await request("/oauth2/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: data.refresh_token, ...extra }, extraHeaders), resource);
      },
      async revoke(refresh = true) {
        return request("/oauth2/revoke", { client_id: clientId, token: refresh ? data.refresh_token : data.access_token });
      },
      sameTokens(other: { matches: (a: unknown, r: unknown) => boolean }) { return other.matches(data.access_token, data.refresh_token); },
      matches(access: unknown, refresh: unknown) { return data.access_token === access && data.refresh_token === refresh; },
    };
  }
  function codeResult(url: URL, verifier: string, resource: string) {
    return {
      issuer: url.searchParams.get("iss"), error: url.searchParams.get("error"), hasCode: url.searchParams.has("code"),
      async exchange(extra: Record<string, unknown> = {}) {
        return tokens(await request("/oauth2/token", { grant_type: "authorization_code", client_id: clientId,
          code: url.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirectUri, resource, ...extra }), resource);
      },
    };
  }
  async function authorize(options: { organizationIndex?: number; resource?: string; scope?: string; query?: Record<string, string | null | undefined>; pick?: boolean } = {}) {
    const resource = options.resource ?? config.mcp;
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      scope: options.scope ?? "feedstocks:read offline_access", resource,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    for (const [key, value] of Object.entries(options.query ?? {})) { if (value === null) query.delete(key); else if (value !== undefined) query.set(key, value); }
    const start = await request(`/oauth2/authorize?${query}`);
    let location = new URL(start.headers.get("location") ?? "/error", config.issuer);
    if (location.pathname === "/oauth/organization" && options.pick !== false) {
      const signed = location.search.slice(1);
      expect(await verifyOAuthQueryParams(signed, env.BETTER_AUTH_SECRET)).toBe(true);
      await selectOAuthOrganization({ attemptKey: oauthAttemptKey(f.sessionId, location.searchParams, resource),
        sessionId: f.sessionId, userId: f.userId, organizationId: f.orgIds[options.organizationIndex ?? 0] });
      const result = await auth.api.oauth2Continue({ asResponse: false, headers, request: new Request(`${config.issuer}/oauth2/continue`, { method: "POST", headers }), body: { oauth_query: signed, postLogin: true } });
      location = new URL(result.url, config.issuer);
    }
    return {
      status: start.status, location,
      code: codeResult(location, verifier, resource),
      async consent(scope?: string) {
        const result = await auth.api.oauth2Consent({ asResponse: false, headers, request: new Request(`${config.issuer}/oauth2/consent`, { method: "POST", headers }), body: { accept: true, scope, oauth_query: location.search.slice(1) } });
        return codeResult(new URL(result.url), verifier, resource);
      },
      async retry() { return request(`/oauth2/authorize?${query}`); },
    };
  }
  const adminHeaders = sessionHeaders(adminToken);
  return { ...f, clientId, config, auth, db, tables, headers, adminHeaders, request, authorize,
    async connect(options: Parameters<typeof authorize>[0] = {}) {
      const flow = await authorize(options);
      const code = flow.location.pathname === "/oauth/consent" ? await flow.consent() : flow.code;
      expect(code.hasCode).toBe(true);
      return code.exchange();
    },
    async cleanup() {
      await db.delete(tables.oauthClients).where(eq(tables.oauthClients.clientId, clientId));
      await f.cleanup();
    },
  };
}
export type OAuthFlowFixture = Awaited<ReturnType<typeof createOAuthFlowFixture>>;
