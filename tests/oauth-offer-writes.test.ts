import { and, eq, inArray, like } from "drizzle-orm";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createOAuthFlowFixture, type OAuthFlowFixture } from "./helpers/oauth-flow";
import { rpcBody } from "./helpers/mcp";
import { buildConsentAreas, preselectStepUp } from "@/components/oauth/consent-areas";
import type { ApiScope } from "@/lib/auth/api-scopes";
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

it("replays the actual 401 discovery scopes for an admin-registered read-only client", async () => {
  const registeredScope = "feedstocks:read offline_access";
  f = await createOAuthFlowFixture({ scope: registeredScope });
  request.headers = f.headers;
  const { GET } = await import("@/app/api/v1/me/route");
  const response = await GET(new Request(`${f.config.rest}/me`));
  expect(response.status).toBe(401);
  const scope = /\bscope="([^"]+)"/.exec(response.headers.get("www-authenticate") ?? "")?.[1];
  expect(scope).toContain("feedstocks:write");
  const flow = await f.authorize({ resource: f.config.rest, scope });
  expect(flow.status).toBe(302);
  expect(flow.location.pathname).toBe("/oauth/consent");
  expect(flow.location.searchParams.get("error")).toBeNull();
  expect(flow.location.searchParams.get("scope")?.split(" ").sort()).toEqual(registeredScope.split(" ").sort());
  const { getOAuthConsentViewFn } = await import("@/fn/oauth");
  expect(await getOAuthConsentViewFn({ oauthQuery: flow.location.search.slice(1) })).toMatchObject({ success: true, data: {
    newlyRequestedScopes: ["feedstocks:read"], offlineAccessRequested: true,
  } });
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

it.each(["mcp", "rest"] as const)("replays the %s challenge to grant an orders write through plain Allow", async audience => {
  f = await createOAuthFlowFixture({ scope: "feedstocks:read feedstocks:write orders:read orders:write offline_access" });
  request.headers = f.headers;
  const resource = f.config[audience];
  const first = await f.authorize({ resource, scope: "feedstocks:read offline_access" });
  const token = await (await first.consent("feedstocks:read offline_access")).exchange();
  expect(token.status).toBe(200);
  expect(token.scope?.split(" ").sort()).toEqual(["feedstocks:read", "offline_access"]);

  async function callOrdersWrite(credential: typeof token) {
    if (audience === "mcp") {
      const { POST } = await import("@/app/api/mcp/route");
      return POST(credential.request(resource, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "record_order", arguments: {} } }) }));
    }
    const { POST } = await import("@/app/api/v1/orders/route");
    return POST(credential.request(`${resource}/orders`, { method: "POST" }));
  }
  const refused = await callOrdersWrite(token);
  expect(refused.status).toBe(403);
  expect(refused.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  const challengeScope = /\bscope="([^"]+)"/.exec(refused.headers.get("www-authenticate") ?? "")?.[1];
  expect(challengeScope).toBeDefined();
  const scope = [...new Set([...challengeScope!.split(" "), "offline_access"])].join(" ");
  const stepUp = await f.authorize({ resource, scope });
  expect(stepUp.location.pathname).toBe("/oauth/consent");
  const { getOAuthConsentViewFn } = await import("@/fn/oauth");
  const result = await getOAuthConsentViewFn({ oauthQuery: stepUp.location.search.slice(1) });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("Step-up consent view failed");
  const view = result.data;
  expect(view.isStepUp).toBe(true);
  expect(view.stepUpScopes).toContain("orders:write");

  // Mirror ConsentBody's plain Allow in step-up mode, including linked read pegs.
  const newly = view.newlyRequestedScopes as ApiScope[];
  const allowed = view.alreadyAllowedScopes as ApiScope[];
  const areas = buildConsentAreas([...newly, ...allowed]);
  expect(areas.find(area => area.entity === "orders")).toMatchObject({ read: "orders:read", write: "orders:write" });
  const ticked = preselectStepUp(areas, newly, view.stepUpScopes as ApiScope[]);
  const submitted = [...new Set<string>([...allowed, ...ticked])].filter(value => value !== "offline_access");
  if (view.offlineAccessRequested) submitted.push("offline_access");
  const upgraded = await (await stepUp.consent(submitted.join(" "))).exchange();
  expect(upgraded.status).toBe(200);
  expect(upgraded.scope?.split(" ")).toEqual(expect.arrayContaining(["orders:read", "orders:write"]));
  expect(await upgraded.resolve()).toMatchObject({ ok: true, ctx: {
    scopes: expect.arrayContaining(["feedstocks:read", "orders:read", "orders:write"]),
  } });
  const admitted = await callOrdersWrite(upgraded);
  // Both empty writes reach the required request key check after scope admission.
  if (audience === "mcp") {
    expect(admitted.status).toBe(200);
    expect((await rpcBody(admitted)).result).toMatchObject({
      isError: true, structuredContent: { code: "idempotency_key_required" },
    });
  } else {
    expect(admitted.status).toBe(400);
    expect(await admitted.json()).toMatchObject({ code: "idempotency_key_required" });
  }
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
    newlyRequestedScopes: ["feedstocks:write"], stepUpScopes: [], isStepUp: false,
  } });
});

it("purges expired step-up hints while preserving live hints and other expired verification namespaces", async () => {
  f = await createOAuthFlowFixture();
  const { recordOAuthStepUp } = await import("@/data-access/oauth-step-up");
  const { purgeExpiredOAuthStepUpHints } = await import("@/data-access/oauth-purge");
  const binding = { userId: f.userId, clientId: f.clientId, organizationId: f.orgIds[0] };
  const now = new Date();
  await recordOAuthStepUp(binding, ["feedstocks:write"], new Date(now.getTime() - OAUTH_STEP_UP_TTL_MS));
  await recordOAuthStepUp({ ...binding, organizationId: f.orgIds[1] }, ["orders:write"], now);
  const hints = await f.db.select().from(f.tables.verifications)
    .where(like(f.tables.verifications.identifier, `oauth-step-up:%${f.userId}%`));
  expect(hints).toHaveLength(2);
  const expired = hints.find(hint => hint.expiresAt.getTime() === now.getTime())!;
  const live = hints.find(hint => hint.expiresAt.getTime() > now.getTime())!;
  const unrelatedId = `other-verification:${f.userId}`;
  await f.db.insert(f.tables.verifications).values({ id: unrelatedId, identifier: `password-reset:${f.userId}`,
    value: "unrelated", expiresAt: now, createdAt: now, updatedAt: now });
  try {
    await purgeExpiredOAuthStepUpHints(now);
    const remaining = await f.db.select().from(f.tables.verifications)
      .where(inArray(f.tables.verifications.id, [expired.id, live.id, unrelatedId]));
    expect(remaining.map(row => row.id).sort()).toEqual([live.id, unrelatedId].sort());
    expect(remaining.find(row => row.id === live.id)).toEqual(live);
  } finally {
    await f.db.delete(f.tables.verifications).where(eq(f.tables.verifications.id, unrelatedId));
  }
});
