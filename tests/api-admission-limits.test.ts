/** Real PostgreSQL buckets and credential resolution. Not run, needs the supervisor. */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { apiRateLimitBuckets } from "@/db/schema";
import { env } from "@/config/env";
import { API_ADMIT_RATE_LIMIT, API_RATE_LIMITS } from "@/config/api-rate-limits";
import { OAUTH_ACCESS_TOKEN_PREFIX } from "@/config/oauth";
import { POST as MCP, GET as MCP_GET } from "@/app/api/mcp/route";
import { POST as REST_WRITE } from "@/app/api/v1/feedstocks/route";
import { GET as ME } from "@/app/api/v1/me/route";
import { guardApiMethod } from "@/lib/api/method-not-allowed";
import { clientIpBucketKey } from "@/lib/api/client-ip";
import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createOAuthFixture, oauthRequest, type OAuthFixture } from "./helpers/oauth";

const TIMEOUT_MS = 30_000;
const FUTURE_MS = 60_000;
const SATURATED_REQUESTS = 3;
let f: OAuthFixture;
let providerEnabled: boolean;
let tracked: Set<string>;
beforeEach(async () => {
  providerEnabled = env.OAUTH_PROVIDER_ENABLED;
  env.OAUTH_PROVIDER_ENABLED = true;
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
  vi.stubEnv("VERCEL", "1");
  tracked = new Set();
  f = await createOAuthFixture();
}, TIMEOUT_MS);
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  env.OAUTH_PROVIDER_ENABLED = providerEnabled;
  if (tracked.size) await db.delete(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, [...tracked]));
  if (f) await f.cleanup();
}, TIMEOUT_MS);
async function credential(kind: "api-key" | "oauth", mcp: boolean) {
  if (kind === "oauth") {
    const access = await f.accessToken({ resource: mcp ? getOAuthConfig().mcp : getOAuthConfig().rest, scopes: ["feedstocks:read"] });
    return { id: access.grant.id, request: (path: string, init: RequestInit = {}) => oauthRequest(access, path, init) };
  }
  const ctx = { ...f.ctx, userId: f.actorId, orgRole: "owner" as const };
  const key = await createApiKey(ctx, { name: "E2E admission key", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
  return { id: key.id, request: (path: string, init: RequestInit = {}) => new Request(`http://localhost:3100${path}`, {
    ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${key.key}` },
  }) };
}
function trackRequest(request: Request, credentialId: string, organizationId: string) {
  tracked.add(clientIpBucketKey(request.headers));
  for (const kind of ["admit", "read", "write"]) tracked.add(`credential:${credentialId}:${kind}`);
  for (const kind of ["read", "write"]) tracked.add(`organization:${organizationId}:${kind}`);
}
const readBucket = async (key: string) => (await db.select().from(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, key)))[0];
async function saturate(key: string) {
  tracked.add(key);
  await db.insert(apiRateLimitBuckets).values({ bucketKey: key, tokens: 0, refilledAt: new Date(Date.now() + FUTURE_MS) })
    .onConflictDoUpdate({ target: apiRateLimitBuckets.bucketKey, set: { tokens: 0, refilledAt: new Date(Date.now() + FUTURE_MS) } });
}

describe("credential admission", { timeout: TIMEOUT_MS }, () => {
  it.each(["GET", "step-up"])("MCP %s debits admission without operation buckets", async kind => {
    const c = await credential("oauth", true);
    const request = c.request("/api/mcp", {
      method: kind === "GET" ? "GET" : "POST",
      headers: { "x-forwarded-for": "192.0.2.132", "content-type": "application/json", accept: "application/json, text/event-stream" },
      ...(kind === "step-up" ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "log_feedstock_delivery", arguments: {} } }) } : {}),
    });
    trackRequest(request, c.id, f.orgIds[0]);
    const response = await (kind === "GET" ? MCP_GET(request) : MCP(request));
    expect(response.status).toBe(kind === "GET" ? 405 : 403);
    if (kind === "step-up") expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(await readBucket(`credential:${c.id}:admit`)).toMatchObject({ tokens: API_ADMIT_RATE_LIMIT - 1 });
    for (const access of ["read", "write"]) {
      expect(await readBucket(`credential:${c.id}:${access}`)).toBeUndefined();
      expect(await readBucket(`organization:${f.orgIds[0]}:${access}`)).toBeUndefined();
    }
  });
  it.each(["api-key", "oauth"] as const)("debits %s before missing scope, malformed MCP, unknown paths and method refusals", async kind => {
    for (const refusal of ["scope", "malformed", "unknown", "method", "mcp method"] as const) {
      const mcp = refusal === "malformed" || refusal === "mcp method";
      const c = await credential(kind, mcp);
      const path = mcp ? "/api/mcp" : refusal === "unknown" ? "/api/v1/unknown" : "/api/v1/feedstocks";
      const request = c.request(path, { method: refusal === "method" ? "PUT" : refusal === "scope" || refusal === "malformed" ? "POST" : "GET",
        headers: { "x-forwarded-for": `192.0.2.${tracked.size + 1}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        ...(refusal === "malformed" ? { body: "[" } : {}),
      });
      trackRequest(request, c.id, f.orgIds[0]);
      // OAuth fixture deliberately reuses the generation between requests.
      await db.delete(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, `credential:${c.id}:admit`));
      const response = refusal === "scope" ? await REST_WRITE(request) : refusal === "malformed" ? await MCP(request)
        : refusal === "mcp method" ? await MCP_GET(request) : (await guardApiMethod(request))!;
      expect(response.status).toBe(refusal === "scope" ? 403 : refusal === "unknown" ? 404 : refusal === "malformed" ? 400 : 405);
      expect(await readBucket(`credential:${c.id}:admit`)).toMatchObject({ tokens: API_ADMIT_RATE_LIMIT - 1 });
    }
  });
  it("stops a saturated generation before malformed body parsing", async () => {
    const c = await credential("oauth", true);
    const request = c.request("/api/mcp", { method: "POST", headers: { "x-forwarded-for": "192.0.2.130" }, body: "[" });
    trackRequest(request, c.id, f.orgIds[0]);
    await saturate(`credential:${c.id}:admit`);
    const response = await MCP(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("ratelimit-limit")).toBe(String(API_ADMIT_RATE_LIMIT));
  });
  it("saturated invalid tokens execute only the pre-auth debit statement on each request", async () => {
    const headers = { "x-forwarded-for": "192.0.2.131" };
    await saturate(clientIpBucketKey(new Headers(headers)));
    const query = vi.spyOn(db.$client, "query");
    for (let index = 0; index < SATURATED_REQUESTS; index++) {
      query.mockClear();
      const response = await ME(new Request("http://localhost:3100/api/v1/me", {
        headers: { ...headers, authorization: `Bearer ${OAUTH_ACCESS_TOKEN_PREFIX}${randomUUID()}` },
      }));
      expect(response.status).toBe(429);
      expect(query).toHaveBeenCalledTimes(1);
      const statement: unknown = query.mock.calls[0][0];
      expect(typeof statement === "string" ? statement : (statement as { text: string }).text).toContain("insert into api_rate_limit_buckets");
    }
  });
  it.each([
    { ip: "160.79.104.0", limit: 6_000 }, { ip: "160.79.111.255", limit: 6_000 },
    { ip: "160.79.112.0", limit: 300 },
  ])("uses the connector tier for $ip", async ({ ip, limit }) => {
    const headers = new Headers({ "x-forwarded-for": ip });
    const key = clientIpBucketKey(headers);
    tracked.add(key);
    await db.delete(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, key));
    // Invalid authentication still pays the selected pre-auth tier.
    headers.set("authorization", `Bearer ${OAUTH_ACCESS_TOKEN_PREFIX}${randomUUID()}`);
    expect((await ME(new Request("http://localhost:3100/api/v1/me", { headers }))).status).toBe(401);
    expect(await readBucket(key)).toMatchObject({ tokens: limit - 1 });
    expect(limit).toBe(ip === "160.79.112.0" ? API_RATE_LIMITS.ip : API_RATE_LIMITS.connectorIp);
  });
});
