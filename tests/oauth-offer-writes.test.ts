import { and, eq, like } from "drizzle-orm";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createOAuthFlowFixture, type OAuthFlowFixture } from "./helpers/oauth-flow";
import { OAUTH_STEP_UP_TTL_MS } from "@/config/oauth";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
let f: OAuthFlowFixture;
beforeAll(() => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true");
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  vi.resetModules();
});
afterEach(async () => {
  if (!f) return;
  // This fixture owns the random user ID embedded in every matching tuple.
  await f.db.delete(f.tables.verifications).where(like(f.tables.verifications.identifier, `oauth-step-up:%${f.userId}%`));
  await f.cleanup();
});

it.each(["mcp", "rest"] as const)("offers writes initially, preserves read-only tokens and remembers a %s refusal", async audience => {
  f = await createOAuthFlowFixture();
  request.headers = f.headers;
  const resource = f.config[audience];
  const first = await f.authorize({ resource, query: { scope: null } });
  expect(first.location.pathname).toBe("/oauth/consent");
  expect(first.location.searchParams.get("scope")?.split(" ").sort()).toEqual(["feedstocks:read", "feedstocks:write", "offline_access"]);
  const token = await (await first.consent("feedstocks:read offline_access")).exchange();
  expect(token.status).toBe(200);
  expect(token.scope?.split(" ").sort()).toEqual(["feedstocks:read", "offline_access"]);
  expect(token.scope).not.toContain(":write");

  const { getOAuthConsentViewFn } = await import("@/fn/oauth");
  // Fresh discovery requests every scope, but the stored refusal supplies the ticked write.
  let response: Response;
  if (audience === "mcp") {
    const { POST } = await import("@/app/api/mcp/route");
    response = await POST(token.request(resource, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "log_feedstock_delivery", arguments: {} } }) }));
  } else {
    const { POST } = await import("@/app/api/v1/feedstocks/route");
    response = await POST(token.request(`${resource}/feedstocks`, { method: "POST" }));
  }
  const refreshed = await token.refresh();
  expect(refreshed.status).toBe(200);
  expect(refreshed.scope?.split(" ").sort()).toEqual(["feedstocks:read", "offline_access"]);
  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  const { findOAuthStepUp } = await import("@/data-access/oauth-step-up");
  expect(await findOAuthStepUp({ userId: f.userId, clientId: f.clientId, organizationId: f.orgIds[0] })).toEqual(["feedstocks:write"]);
  const stepUp = await f.authorize({ resource, query: { scope: null } });
  expect(await getOAuthConsentViewFn({ oauthQuery: stepUp.location.search.slice(1) })).toMatchObject({ success: true, data: {
    newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], stepUpScopes: ["feedstocks:write"], isStepUp: true,
  } });
});

it("replaces one pending tuple and isolates other users, clients and organizations through expiry", async () => {
  f = await createOAuthFlowFixture();
  const { recordOAuthStepUp, findOAuthStepUp } = await import("@/data-access/oauth-step-up");
  const binding = { userId: f.userId, clientId: f.clientId, organizationId: f.orgIds[0] };
  const now = new Date();
  await recordOAuthStepUp(binding, ["feedstocks:write"], now);
  await recordOAuthStepUp(binding, ["orders:write"], now);
  expect(await findOAuthStepUp(binding, now)).toEqual(["orders:write"]);
  for (const other of [{ ...binding, userId: f.actorId }, { ...binding, clientId: "other-client" }, { ...binding, organizationId: f.orgIds[1] }]) {
    expect(await findOAuthStepUp(other, now)).toEqual([]);
  }
  const rows = await f.db.select().from(f.tables.verifications).where(and(
    like(f.tables.verifications.identifier, `oauth-step-up:%${f.userId}%`),
    eq(f.tables.verifications.createdAt, now),
  ));
  expect(rows).toHaveLength(1);
  expect(rows[0].expiresAt.getTime()).toBe(now.getTime() + OAUTH_STEP_UP_TTL_MS);
  expect(await findOAuthStepUp(binding, new Date(now.getTime() + OAUTH_STEP_UP_TTL_MS))).toEqual([]);
});

it("ignores an expired pending hint in consent even when all scopes are requested", async () => {
  f = await createOAuthFlowFixture();
  request.headers = f.headers;
  await f.connect();
  const { recordOAuthStepUp } = await import("@/data-access/oauth-step-up");
  await recordOAuthStepUp({ userId: f.userId, clientId: f.clientId, organizationId: f.orgIds[0] }, ["feedstocks:write"],
    new Date(Date.now() - OAUTH_STEP_UP_TTL_MS));
  const flow = await f.authorize({ query: { scope: null } });
  const { getOAuthConsentViewFn } = await import("@/fn/oauth");
  expect(await getOAuthConsentViewFn({ oauthQuery: flow.location.search.slice(1) })).toMatchObject({ success: true, data: {
    newlyRequestedScopes: ["feedstocks:write"], stepUpScopes: [], isStepUp: true,
  } });
});
