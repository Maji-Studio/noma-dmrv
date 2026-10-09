import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { API_LIST_MAX_LIMIT, API_VERSION } from "@/config/api-rest";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { DomainError } from "@/lib/domain-errors";
import { buildOpenApiDocument } from "@/lib/api/openapi/document";
import { GET, POST, DELETE } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), pre: vi.fn(), post: vi.fn(), me: vi.fn(), log: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://noma.example" } }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/api/guards", () => ({ preAuthGuard: mocks.pre, postAuthGuard: mocks.post }));
vi.mock("@/lib/read-models/api-me", () => ({ readApiMe: mocks.me }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log } }));
// Real argument parsers and cursor codecs; readers never connect to a database.
vi.mock("@/lib/read-models/api-facilities", () => ({ readApiFacilityList: vi.fn() }));
vi.mock("@/lib/read-models/api-suppliers", () => ({ readApiSupplierList: vi.fn() }));
vi.mock("@/lib/read-models/api-supplier-locations", () => ({ readApiSupplierLocationList: vi.fn() }));
vi.mock("@/lib/read-models/api-feedstock-types", () => ({ readApiFeedstockTypeList: vi.fn() }));
vi.mock("@/lib/read-models/api-storage-locations", () => ({ readApiStorageLocationList: vi.fn() }));
vi.mock("@/lib/read-models/api-vehicles", () => ({ readApiVehicleList: vi.fn() }));
vi.mock("@/lib/read-models/api-drivers", () => ({ readApiDriverList: vi.fn() }));
vi.mock("@/lib/read-models/api-feedstocks", () => ({ readApiFeedstockList: vi.fn(), readApiFeedstock: vi.fn() }));

const ENDPOINT = "http://localhost:3100/api/mcp";
const rateHeaders = { "RateLimit-Limit": "600", "RateLimit-Remaining": "599", "RateLimit-Reset": "1" };
function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18", authorization: "Bearer test-key", ...headers,
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function body(response: Response) {
  const text = await response.text();
  return JSON.parse(text.trim().startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length)).join(""));
}
const call = (name: string, args: Record<string, unknown> = {}) => POST(rpc("tools/call", { name, arguments: args }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: API_SCOPES, organizationId: "org-1" } });
  mocks.pre.mockResolvedValue({ response: null, result: null });
  mocks.post.mockResolvedValue({ ok: true, headers: new Headers(rateHeaders) });
  mocks.me.mockResolvedValue({ organization: { id: "org-1", name: "Test" }, facilities: [], role: "admin", scopes: API_SCOPES,
    credential: { id: "key-1", name: null, expiresAt: "2027-01-01T00:00:00.000Z" } });
});
afterEach(() => vi.useRealTimers());

describe("authenticated MCP read route", () => {
  it("refuses hostile Origin before admission, even with a valid credential", async () => {
    expect((await POST(rpc("tools/list", {}, { origin: "https://attacker.example" }))).status).toBe(403);
    expect(mocks.pre).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("refuses GET and DELETE", () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });
  it("challenges missing credentials at HTTP level", async () => {
    mocks.resolve.mockResolvedValue({ ok: false, denial: "credential_missing" });
    const response = await POST(rpc("tools/list", {}, { authorization: "" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("serves in production, accepts the configured Origin and charges the read buckets", async () => {
    const response = await POST(rpc("tools/list", {}, { origin: "https://noma.example" }));
    expect(response.status).toBe(200);
    expect(mocks.post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ access: "read" }), null);
    for (const [key, value] of Object.entries(rateHeaders)) expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const { result } = await body(response);
    expect(result.tools).toHaveLength(10);
    expect(result.tools.every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint)).toBe(true);
    const find = result.tools.find((tool: { name: string }) => tool.name === "find_feedstocks");
    expect(find.inputSchema.additionalProperties).toBe(false);
    expect(find.inputSchema.properties.limit).toMatchObject({ type: "integer", minimum: 1, maximum: API_LIST_MAX_LIMIT });
    expect(find.outputSchema.anyOf).toHaveLength(2);
  });
  it("publishes the configured server version", async () => {
    const { result } = await body(await POST(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })));
    expect(result.serverInfo.version).toBe(API_VERSION);
  });
  it("filters discovery and makes hidden and unknown tool calls indistinguishable", async () => {
    mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: [] } });
    const { result } = await body(await POST(rpc("tools/list")));
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["whoami"]);
    expect((await body(await call("find_feedstocks"))).error).toEqual((await body(await call("unknown"))).error);
  });
  it.each([{ unknown: true }, { limit: API_LIST_MAX_LIMIT + 1 }, { limit: 0 }, { limit: 1.5 }])("returns structured query validation for %j", async (args) => {
    expect(await body(await call("find_feedstocks", args))).toMatchObject({ result: { isError: true, structuredContent: { code: "invalid_query", issues: [] } } });
  });
  it("accepts numeric limit and converts malformed cursors as REST does", async () => {
    expect(await body(await call("find_feedstocks", { limit: 1, cursor: "bad" }))).toMatchObject({ result: { isError: true, structuredContent: { code: "invalid_cursor", issues: [] } } });
  });
  it.each(["not_found", "forbidden"] as const)("returns structured %s and JSON Pointer issues", async (code) => {
    mocks.me.mockRejectedValue(new DomainError(code, "Resource unavailable.", { issues: [{ path: ["a/b~"], code, message: "Unavailable." }] }));
    expect(await body(await call("whoami"))).toMatchObject({ result: { isError: true, structuredContent: { code, issues: [{ pointer: "/a~1b~0" }] } } });
  });
  it("sanitizes internal errors and logs only the request id and trusted classification", async () => {
    mocks.me.mockRejectedValue(new Error("private-input-secret"));
    const response = await call("whoami");
    const payload = await body(response);
    expect(payload.error).toMatchObject({ code: -32603, message: "The request could not be completed." });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ op: "whoami", requestId: response.headers.get("x-request-id") }), expect.any(String));
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private-input-secret");
  });
  it("checks the pre-auth deadline inside the tool before reading", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    mocks.resolve.mockImplementation(async () => {
      vi.setSystemTime(now + OPERATION_DEADLINE_MS);
      return { ok: true, ctx: { orgRole: "admin", scopes: [] } };
    });
    expect(await body(await call("whoami"))).toMatchObject({ result: { isError: true, structuredContent: { code: "deadline_exceeded" } } });
    expect(mocks.me).not.toHaveBeenCalled();
  });
  it("preserves HTTP rate-limit refusals", async () => {
    mocks.post.mockResolvedValue({ ok: false, response: Response.json({ code: "rate_limited" }, { status: 429, headers: { ...rateHeaders, "Retry-After": "1" } }) });
    const response = await call("whoami");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(mocks.me).not.toHaveBeenCalled();
  });
  it("answers malformed JSON with a protocol error", async () => {
    const request = rpc("tools/list");
    const response = await POST(new Request(request.url, { method: "POST", headers: request.headers, body: "{" }));
    expect((await body(response)).error).toMatchObject({ code: -32700 });
  });
});

it("serves read results on MCP revision 2026-07-28", async () => {
  const request = rpc("tools/call", { name: "whoami", arguments: {}, _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  } }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "whoami" });
  const response = await POST(request);
  const payload = await body(response);
  expect(response.status, JSON.stringify(payload)).toBe(200);
  expect(payload).toMatchObject({ result: { structuredContent: { data: { organization: { id: "org-1" } } } } });
});

it("publishes the same input fields and constraints as the matching OpenAPI parameters", async () => {
  const { result } = await body(await POST(rpc("tools/list")));
  const operations = Object.values(buildOpenApiDocument().paths).flatMap((path) => Object.values(path));
  for (const tool of result.tools) {
    const operation = operations.find((candidate) => candidate.operationId === tool.name)!;
    const parameters = operation.parameters as { name: string; required: boolean; schema: Record<string, unknown> }[];
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(parameters.map((parameter) => parameter.name).sort());
    for (const parameter of parameters) {
      expect(tool.inputSchema.properties[parameter.name]).toMatchObject(parameter.schema);
      expect(tool.inputSchema.required?.includes(parameter.name) ?? false).toBe(parameter.required);
    }
  }
});
