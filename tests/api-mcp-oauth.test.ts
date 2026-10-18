/** DB-backed transport suite. Not run, needs the supervisor. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, members, organizationApiAccess } from "@/db/schema";
import { env } from "@/config/env";
import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { POST as MCP } from "@/app/api/mcp/route";
import { POST as REST } from "@/app/api/v1/feedstocks/route";
import { updateApiKey } from "@/data-access/api-keys";
import { createOAuthFixture, oauthRpc, oauthRequest, type OAuthFixture } from "./helpers/oauth";
import { rpc, rpcBody } from "./helpers/mcp";
import { apiActivityWhere } from "./helpers/api-activity";
import { createApiFeedstockFixture, removeApiFeedstockFixture, decodedIntake, committedFeedstocks, type ApiFeedstockFixture } from "./helpers/api-feedstock-fixture";

const TIMEOUT_MS = 30_000;
const MASS_KG = 100;
let f: ApiFeedstockFixture;
let oauth: OAuthFixture;
let memberId: string;
const switches = { provider: false, writes: false };
beforeEach(async () => {
  switches.provider = env.OAUTH_PROVIDER_ENABLED;
  switches.writes = env.API_WRITES_DISABLED;
  env.OAUTH_PROVIDER_ENABLED = true;
  env.API_WRITES_DISABLED = false;
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  f = await createApiFeedstockFixture("oauth-mcp");
  oauth = await createOAuthFixture();
  memberId = randomUUID();
  await db.insert(members).values({ id: memberId, organizationId: f.ctx.organizationId, userId: oauth.userId, role: "member" });
}, TIMEOUT_MS);
afterEach(async () => {
  env.OAUTH_PROVIDER_ENABLED = switches.provider;
  env.API_WRITES_DISABLED = switches.writes;
  vi.unstubAllEnvs();
  if (oauth) await oauth.cleanup();
  if (f) await removeApiFeedstockFixture(f);
}, TIMEOUT_MS);
const access = (scopes = ["feedstocks:read"], resource = getOAuthConfig().mcp) => oauth.accessToken({
  scopes, resource, organizationId: f.ctx.organizationId, memberId,
});
function intake() {
  const input = decodedIntake(f, MASS_KG);
  return { ...input, deliveryDate: input.deliveryDate.toISOString().split("T")[0] };
}
const audits = () => db.select().from(activityEvents).where(apiActivityWhere(f.ctx.organizationId));
async function call(token: Awaited<ReturnType<typeof access>>, name: string, args: Record<string, unknown>) {
  const response = await MCP(oauthRpc(token, "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}

describe("OAuth MCP admission and writes", { timeout: TIMEOUT_MS }, () => {
  it.each(["owner", "admin", "member"])("lists grantable tools within the live %s ceiling", async role => {
    await db.update(members).set({ role }).where(and(eq(members.organizationId, f.ctx.organizationId), eq(members.id, memberId)));
    const token = await access();
    const response = await MCP(oauthRpc(token, "tools/list"));
    expect(response.status).toBe(200);
    const names = (await rpcBody(response)).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["find_feedstocks", "find_deliveries", "log_feedstock_delivery", "request_document_upload"]));
    expect(names.some((name: string) => name.startsWith("delete_"))).toBe(false);
  });
  it.each([
    { name: "log_feedstock_delivery", args: {}, scope: "feedstocks:write" },
    { name: "find_documents", args: { ownerType: "delivery" }, scope: "deliveries:read" },
    { name: "confirm_document_upload", args: { ownerType: "application" }, scope: "applications:write" },
  ])("steps up $name over HTTP before dispatch", async ({ name, args, scope }) => {
    const response = await MCP(oauthRpc(await access(), "tools/call", { name, arguments: args }));
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(`error="insufficient_scope", scope="feedstocks:read ${scope}"`);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="http://localhost:3100/.well-known/oauth-protected-resource/api/mcp"');
    expect(await response.json()).toMatchObject({ code: "missing_scope" });
    expect(await audits()).toHaveLength(0);
  });
  it("refuses delete without a step-up loop even with a stored delete claim", async () => {
    const response = await MCP(oauthRpc(await access([...API_SCOPES]), "tools/call", { name: "delete_feedstock", arguments: {} }));
    expect(response.status).toBe(200);
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect((await rpcBody(response)).error.message).toBe("Unknown tool.");
  });
  it("preserves filtered lists, Unknown tool and in-MCP missing_scope for keys", async () => {
    await updateApiKey(f.ctx, { id: f.credentialId, expectedVersion: 1, name: "E2E OAuth MCP key", scopes: ["feedstocks:read"] });
    const names = (await rpcBody(await MCP(rpc(f.key, "tools/list")))).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain("log_feedstock_delivery");
    const hidden = await MCP(rpc(f.key, "tools/call", { name: "log_feedstock_delivery", arguments: {} }));
    expect(hidden.status).toBe(200);
    expect((await rpcBody(hidden)).error.message).toBe("Unknown tool.");
    const document = await MCP(rpc(f.key, "tools/call", { name: "find_documents", arguments: { ownerType: "delivery" } }));
    expect(document.status).toBe(200);
    expect((await rpcBody(document)).result).toMatchObject({ isError: true, structuredContent: { code: "missing_scope" } });
  });
  it("audits the grant and client once, and replays across tokens and step-up within one generation", async () => {
    const first = await access(["feedstocks:read", "feedstocks:write"]);
    const args = { ...intake(), requestKey: randomUUID() };
    const created = await call(first, "log_feedstock_delivery", args);
    expect(created.isError).toBeUndefined();
    const second = await access(["feedstocks:read", "feedstocks:write", "deliveries:read"]);
    expect(second.grant.id).toBe(first.grant.id);
    const replay = await call(second, "log_feedstock_delivery", args);
    expect(replay.structuredContent).toEqual(created.structuredContent);
    expect(replay.content[0].text).toMatch(/^Replayed:/);
    expect(await committedFeedstocks(f)).toHaveLength(1);
    expect(await audits()).toMatchObject([{ credentialId: first.grant.id, oauthClientId: oauth.clientId, source: "mcp" }]);
  });
  it("keeps REST and MCP resource generations in separate replay namespaces", async () => {
    const restToken = await access(["feedstocks:read", "feedstocks:write"], getOAuthConfig().rest);
    const mcpToken = await access(["feedstocks:read", "feedstocks:write"]);
    expect(restToken.grant.id).not.toBe(mcpToken.grant.id);
    const key = randomUUID();
    const rest = await REST(oauthRequest(restToken, "/api/v1/feedstocks", { method: "POST", headers: {
      "content-type": "application/json", "idempotency-key": key,
    }, body: JSON.stringify(intake()) }));
    expect(rest.status).toBe(201);
    const saved = await call(mcpToken, "log_feedstock_delivery", { ...intake(), requestKey: key });
    expect(saved.isError).toBeUndefined();
    expect(saved.content[0].text).not.toMatch(/^Replayed:/);
    expect(await committedFeedstocks(f)).toHaveLength(2);
    const records = await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
    expect(records.map(row => row.credentialId).sort()).toEqual([restToken.grant.id, mcpToken.grant.id].sort());
    expect(await audits()).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "rest", credentialId: restToken.grant.id, oauthClientId: oauth.clientId }),
      expect.objectContaining({ source: "mcp", credentialId: mcpToken.grant.id, oauthClientId: oauth.clientId }),
    ]));
  });
  it("enforces the writes switch and organization API access", async () => {
    const token = await access(["feedstocks:read", "feedstocks:write"]);
    env.API_WRITES_DISABLED = true;
    expect(await call(token, "log_feedstock_delivery", { ...intake(), requestKey: randomUUID() })).toMatchObject({
      isError: true, structuredContent: { code: "api_writes_disabled" },
    });
    expect((await MCP(oauthRpc(token, "tools/list"))).status).toBe(200);
    await db.insert(organizationApiAccess).values({ organizationId: f.ctx.organizationId, enabled: false, changedByUserId: oauth.actorId });
    const refused = await MCP(oauthRpc(token, "tools/list"));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "api_access_disabled" });
    expect(await committedFeedstocks(f)).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });
});
