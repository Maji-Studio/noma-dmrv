import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiKeyContext } from "../../../tests/helpers/api-context";
import { rpc, rpcBody } from "../../../tests/helpers/mcp";
import { API_SCOPES, principalAllows } from "@/lib/auth/api-scopes";
import { oauthRoleCeiling } from "@/lib/auth/oauth-scopes";
import { API_DOCUMENT_OWNER_TYPES } from "@/lib/documents/api-owners";
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/mcp/server", { spy: true });
import { env } from "@/config/env";
import { POST } from "@/app/api/mcp/route";
import { mcpRequestRequiredScopes, serveMcp } from "./server";
import { writeTools } from "./tools/write-tools";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
let providerEnabled: boolean;
const oauth = (orgRole: "owner" | "admin" | "member" = "member") => ({
  ...apiKeyContext({ orgRole, scopes: ["feedstocks:read"] }),
  principal: { kind: "oauth" as const, credentialId: "grant", userId: "user", oauthClientId: "client" },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  providerEnabled = env.OAUTH_PROVIDER_ENABLED;
  env.OAUTH_PROVIDER_ENABLED = true;
  mocks.resolve.mockResolvedValue({ ok: true, ctx: oauth() });
});
afterEach(() => {
  vi.unstubAllEnvs();
  env.OAUTH_PROVIDER_ENABLED = providerEnabled;
});
it("refuses a write without its scope when dispatch is called directly", async () => {
  const tool = writeTools.find(tool => tool.name === "log_feedstock_delivery")!;
  const execute = vi.spyOn(tool, "execute").mockRejectedValue(new Error("Must not execute."));
  const response = await serveMcp(rpc("synthetic", "tools/call", { name: tool.name, arguments: {} }), {
    ctx: oauth(), deadlineAt: Date.now() + OPERATION_DEADLINE_MS,
    instance: "/api/mcp", requestId: "request", headers: new Headers(),
  });
  expect((await rpcBody(response)).result).toMatchObject({ isError: true, structuredContent: { code: "missing_scope" } });
  expect(execute).not.toHaveBeenCalled();
});
it.each(["find_documents", "get_document_download_url"].flatMap(name =>
  [{}, { ownerType: "unknown" }].map(args => ({ name, args }))))("keeps invalid owner queries inside MCP: $name $args", async ({ name, args }) => {
  expect(mcpRequestRequiredScopes(oauth(), { method: "tools/call", params: { name, arguments: args } })).toEqual([]);
  const response = await POST(rpc("synthetic", "tools/call", { name, arguments: args }));
  expect(response.status).toBe(200);
  expect(response.headers.has("www-authenticate")).toBe(false);
  expect((await rpcBody(response)).result).toMatchObject({ isError: true, structuredContent: {
    code: "invalid_query", issues: [expect.objectContaining({ pointer: "/ownerType" })],
  } });
});
it.each(["owner", "admin", "member"] as const)("lists reads and writes within the %s ceiling and hides deletes", async role => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: oauth(role) });
  const body = await rpcBody(await POST(rpc("synthetic", "tools/list")));
  const names = body.result.tools.map((tool: { name: string }) => tool.name);
  expect(names).toContain("log_feedstock_delivery");
  expect(names).toContain("request_document_upload");
  expect(names).toContain("find_deliveries");
  expect(names).not.toContain("delete_feedstock");
  expect(names).not.toContain("delete_customer_location");
});
it.each([
  { name: "log_feedstock_delivery", arguments: {}, scope: "feedstocks:write" },
  { name: "find_documents", arguments: { ownerType: "delivery" }, scope: "deliveries:read" },
  { name: "request_document_upload", arguments: { ownerType: "application" }, scope: "applications:write" },
])("steps up $name before parsing or dispatch", async ({ name, arguments: args, scope }) => {
  const response = await POST(rpc("synthetic", "tools/call", { name, arguments: args }));
  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toContain(`error="insufficient_scope", scope="feedstocks:read ${scope}"`);
  expect(await response.json()).toMatchObject({ code: "missing_scope" });
  expect(serveMcp).not.toHaveBeenCalled();
});
const writeStepUps = (["owner", "admin", "member"] as const).flatMap(role => {
  const ceiling = { ...oauth(role), scopes: [...oauthRoleCeiling(role)] };
  return writeTools.filter(tool => tool.visible ? tool.visible(ceiling)
    : tool.requiredScopes({}).every(scope => principalAllows(ceiling, scope)))
    .flatMap(tool => (tool.scope ? [{}] : API_DOCUMENT_OWNER_TYPES.map(ownerType => ({ ownerType })))
      .map(args => ({ role, tool, args })));
});
it.each(writeStepUps)("steps up $role $tool.name $args without dispatch", async ({ role, tool, args }) => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: oauth(role) });
  const execute = vi.spyOn(tool, "execute").mockRejectedValue(new Error("Must not execute."));
  const response = await POST(rpc("synthetic", "tools/call", { name: tool.name, arguments: args }));
  expect(response.status).toBe(403);
  const challenge = response.headers.get("www-authenticate");
  expect(challenge).toContain('error="insufficient_scope"');
  for (const scope of tool.requiredScopes(args)) expect(challenge).toContain(scope);
  expect(await response.json()).toMatchObject({ code: "missing_scope" });
  expect(serveMcp).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
it("never offers step-up for delete even if the token claims every scope", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { ...oauth(), scopes: [...API_SCOPES] } });
  const response = await POST(rpc("synthetic", "tools/call", { name: "delete_feedstock", arguments: {} }));
  expect(response.status).toBe(200);
  expect(response.headers.has("www-authenticate")).toBe(false);
  expect((await rpcBody(response)).error.message).toBe("Unknown tool.");
});
it("keeps hidden key tools unknown and owner-scope errors inside MCP", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: apiKeyContext({ scopes: ["feedstocks:read"] }) });
  const hidden = await POST(rpc("synthetic", "tools/call", { name: "log_feedstock_delivery", arguments: {} }));
  expect(hidden.status).toBe(200);
  expect((await rpcBody(hidden)).error.message).toBe("Unknown tool.");
  const document = await POST(rpc("synthetic", "tools/call", { name: "find_documents", arguments: { ownerType: "delivery" } }));
  expect(document.status).toBe(200);
  expect((await rpcBody(document)).result).toMatchObject({ isError: true, structuredContent: { code: "missing_scope" } });
});
