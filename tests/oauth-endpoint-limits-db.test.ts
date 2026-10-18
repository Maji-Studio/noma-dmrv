/** Real shared Postgres bucket and nested consent dispatch. */
import { MAX_VERCEL_DB_POOL_MAX } from "@/db/pool-config";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOAuthFlowFixture, type OAuthFlowFixture } from "./helpers/oauth-flow";

const FUTURE_MS = 60_000;
const TIMEOUT_MS = 30_000;
let f: OAuthFlowFixture | undefined;
let bucketKey: string | undefined;
beforeEach(() => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true");
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", "");
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
  vi.stubEnv("VERCEL", "1");
  // Vercel caps the per-instance pool; the reloaded db module enforces it.
  vi.stubEnv("DB_POOL_MAX", String(MAX_VERCEL_DB_POOL_MAX));
  vi.resetModules();
});
afterEach(async () => {
  if (f && bucketKey) await f.db.delete(f.tables.apiRateLimitBuckets).where(eq(f.tables.apiRateLimitBuckets.bucketKey, bucketKey));
  await f?.cleanup();
  f = undefined;
  bucketKey = undefined;
  vi.unstubAllEnvs();
}, TIMEOUT_MS);

it("charges one HTTP consent once despite nested authorize, then shares exhaustion across app instances", async () => {
  f = await createOAuthFlowFixture();
  const flow = await f.authorize();
  expect(flow.location.pathname).toBe("/oauth/consent");
  const { clientIpBucketKey } = await import("@/lib/api/client-ip");
  const { POST } = await import("@/app/api/auth/[...all]/route");
  const headers = new Headers(f.headers);
  headers.set("content-type", "application/json");
  headers.set("x-forwarded-for", "192.0.2.214");
  bucketKey = `oauth-${clientIpBucketKey(headers)}`;
  // A future refill timestamp prevents elapsed real time hiding extra debits.
  await f.db.insert(f.tables.apiRateLimitBuckets).values({
    bucketKey, tokens: 1, refilledAt: new Date(Date.now() + FUTURE_MS),
  }).onConflictDoUpdate({ target: f.tables.apiRateLimitBuckets.bucketKey,
    set: { tokens: 1, refilledAt: new Date(Date.now() + FUTURE_MS) } });
  const response = await POST(new Request(`${f.config.issuer}/oauth2/consent`, {
    method: "POST", headers, body: JSON.stringify({ accept: true, oauth_query: flow.location.search.slice(1) }),
  }));
  expect(response.status).toBe(200);
  const result = await response.json();
  const redirect = new URL(result.url);
  expect(redirect.searchParams.has("code")).toBe(true);
  expect(redirect.searchParams.get("iss")).toBe(f.config.issuer);
  const [row] = await f.db.select().from(f.tables.apiRateLimitBuckets).where(eq(f.tables.apiRateLimitBuckets.bucketKey, bucketKey));
  expect(row.tokens).toBe(0);
  // A new module instance has no local limiter state in common with the first.
  vi.resetModules();
  const second = await import("@/app/api/auth/[...all]/route");
  expect((await second.POST(new Request(`${f.config.issuer}/oauth2/continue`, {
    method: "POST", headers, body: "{}",
  }))).status).toBe(429);
}, TIMEOUT_MS);
