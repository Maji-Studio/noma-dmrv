import { DOCUMENT_GUIDANCE } from "@/lib/operations/document-guidance";
import { DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { API_BODY_MAX_BYTES, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_VERSION } from "@/config/api-rest";
import { ProtocolErrorCode } from "@modelcontextprotocol/server";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { serveMcp, mcpRequestAccess } from "@/lib/mcp/server";
import { DomainError } from "@/lib/domain-errors";
import { buildOpenApiDocument } from "@/lib/api/openapi/document";
import { GET, POST, DELETE } from "./route";
import { mcpInstructions } from "@/lib/mcp/instructions";
import { biocharStockGuide, domainGuide, labSampleGuide, orderGuide, deliveryGuide, llmsGuide } from "@/lib/api/llms-guide";

const MCP_INSTRUCTIONS_MAX_CHARS = 2000;
vi.mock("@/db", () => ({ db: {} }));

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), pre: vi.fn(), post: vi.fn(), me: vi.fn(), stock: vi.fn(), log: vi.fn(), env: { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://noma.example", API_WRITES_DISABLED: false } }));
vi.mock("@/data-access/delivery-output-writes", () => ({}));
vi.mock("@/lib/read-models/api-deliveries", () => ({ readApiDelivery: vi.fn(), readApiDeliveryList: vi.fn() }));
vi.mock("@/data-access/orders", () => ({}));
vi.mock("@/data-access/organization-settings", () => ({}));
vi.mock("@/data-access/transport-legs", () => ({}));
vi.mock("@/lib/read-models/api-orders", () => ({ readApiOrder: vi.fn(), readApiOrderList: vi.fn() }));
vi.mock("@/lib/read-models/api-customers", () => ({ readApiCustomer: vi.fn(), readApiCustomerList: vi.fn() }));
vi.mock("@/lib/read-models/api-customer-locations", () => ({ readApiCustomerLocationList: vi.fn() }));
vi.mock("@/lib/read-models/api-order-balance", () => ({ readApiOrderBalance: vi.fn() }));
vi.mock("@/data-access/samples", () => ({}));
vi.mock("@/lib/read-models/api-lab-samples", () => ({ readApiLabSample: vi.fn(), readApiLabSampleList: vi.fn() }));
vi.mock("@/lib/read-models/api-credit-batches", () => ({ readApiCreditBatch: vi.fn(), readApiCreditBatchList: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: vi.fn() }));
vi.mock("@/data-access/feedstocks", () => ({}));
vi.mock("@/data-access/production-runs", () => ({}));
vi.mock("@/data-access/production-run-input", () => ({}));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/lib/read-models/api-production-runs", () => ({ readApiProductionRun: vi.fn(), readApiProductionRunList: vi.fn() }));
vi.mock("@/lib/read-models/api-reactors", () => ({ readApiReactorList: vi.fn() }));
vi.mock("@/data-access/storage-object-deletions", () => ({}));
vi.mock("@/data-access/biochar-product-references", () => ({}));
vi.mock("@/data-access/biochar-product-create", () => ({}));
vi.mock("@/data-access/biochar-product-input", () => ({}));
vi.mock("@/data-access/biochar-product-update", () => ({}));
vi.mock("@/data-access/biochar-product-record", () => ({}));
vi.mock("@/data-access/output-stock-post", () => ({}));
vi.mock("@/data-access/api-output-stock-movements", () => ({ requireApiOutputBin: vi.fn() }));
vi.mock("@/lib/read-models/api-output-bin-stock", () => ({ readApiOutputBinStock: mocks.stock }));
vi.mock("@/lib/read-models/api-biochar-products", () => ({ readApiBiocharProduct: vi.fn(), readApiBiocharProductList: vi.fn() }));
vi.mock("@/lib/read-models/api-formulations", () => ({ readApiFormulation: vi.fn(), readApiFormulationList: vi.fn() }));
vi.mock("@/lib/read-models/api-output-stock-movements", () => ({ readApiOutputStockMovement: vi.fn(), readApiOutputStockMovementList: vi.fn() }));
vi.mock("@/lib/mcp/server", { spy: true });
vi.mock("@/config/env", () => ({ env: mocks.env }));
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

it("returns the shared domain guidance during initialize", async () => {
  const { result } = await body(await POST(rpc("initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unit-test", version: "1" },
  })));
  expect(result.instructions).toBe(mcpInstructions);
  expect(result.instructions).toContain(domainGuide);
  expect(llmsGuide).toContain(domainGuide);
  expect(result.instructions.length).toBeLessThan(MCP_INSTRUCTIONS_MAX_CHARS);
  expect(llmsGuide).toContain(biocharStockGuide);
  expect(llmsGuide).toContain(labSampleGuide);
  expect(llmsGuide).toContain(orderGuide);
  expect(llmsGuide).toContain(deliveryGuide);
  expect(result.instructions).not.toContain(DOCUMENT_GUIDANCE);
  for (const name of ["find_applications", "get_application", "get_delivery_application_balance", "record_application", "update_application", "delete_application"]) {
    expect(llmsGuide).toContain(name); expect(result.instructions).not.toContain(name);
  }
  expect(llmsGuide).toContain(DOCUMENT_GUIDANCE);
  expect(result.instructions).not.toContain(deliveryGuide);
  expect(result.instructions).not.toContain(orderGuide);
  expect(result.instructions).not.toContain(labSampleGuide);
  for (const guidance of ["4200 kg", "wet mass", "dry mass", "receiving bin", "moisture", "whoami", "requestKey", "dryRun", "expectedVersion", "retryable", "untrusted data"]) {
    expect(result.instructions.toLowerCase()).toContain(guidance.toLowerCase());
  }
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.API_WRITES_DISABLED = false;
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
    expect(result.tools).toHaveLength(55);
    expect(result.tools[0]).toMatchObject({ annotations: { readOnlyHint: true } });
    expect(result.tools.filter((tool: { name: string }) => !["record_application", "update_application", "delete_application", "request_document_upload", "confirm_document_upload", "log_feedstock_delivery", "update_feedstock", "delete_feedstock", "start_production_run", "update_production_run", "delete_production_run", "make_biochar_product", "update_biochar_product", "record_output_stock_movement", "record_lab_sample", "update_lab_sample", "delete_lab_sample", "record_order", "update_order", "delete_order", "record_delivery", "update_delivery"].includes(tool.name)).every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint)).toBe(true);
    const find = result.tools.find((tool: { name: string }) => tool.name === "find_feedstocks");
    expect(find.inputSchema.additionalProperties).toBe(false);
    expect(find.inputSchema.properties.limit).toMatchObject({ type: "integer", minimum: 1, maximum: API_LIST_MAX_LIMIT,
      description: `Page size, integer 1 to ${API_LIST_MAX_LIMIT}; defaults to ${API_LIST_DEFAULT_LIMIT}.` });
    for (const tool of result.tools) {
      expect(tool.outputSchema.type).toBe("object");
      expect(tool.outputSchema.anyOf).toHaveLength(2);
    }
  });
  it("refuses legacy batches before authenticated buckets or dispatch", async () => {
    const request = rpc("tools/call", { name: "whoami", arguments: {} });
    const message = await request.json();
    const response = await POST(new Request(ENDPOINT, {
      method: "POST", headers: request.headers,
      body: JSON.stringify([message, { ...message, id: 2 }]),
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toMatchObject({
      code: "batch_not_supported", detail: "Send one JSON-RPC message per request.",
    });
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(serveMcp).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.me).not.toHaveBeenCalled();
  });
  it.each(["declared", "chunked"])("bounds a %s body before authenticated buckets or dispatch", async (kind) => {
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new Uint8Array(API_BODY_MAX_BYTES / 2 + 1));
    });
    const stream = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
    const headers = rpc("tools/call").headers;
    if (kind === "declared") headers.set("content-length", String(API_BODY_MAX_BYTES + 1));
    mocks.pre.mockResolvedValue({ response: null, result: { allowed: true, limit: 600, remaining: 599, resetSeconds: 1 } });
    const response = await POST(new Request(ENDPOINT, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit));
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    for (const [key, value] of Object.entries(rateHeaders)) expect(response.headers.get(key)).toBe(value);
    expect(await response.json()).toMatchObject({ code: "payload_too_large" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledTimes(kind === "declared" ? 0 : 2);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.me).not.toHaveBeenCalled();
  });
  it("serves a body exactly at the byte limit and names the organization", async () => {
    const request = rpc("tools/call", { name: "whoami", arguments: {} });
    const json = await request.text();
    const padded = json + " ".repeat(API_BODY_MAX_BYTES - new TextEncoder().encode(json).length);
    request.headers.set("content-length", String(API_BODY_MAX_BYTES));
    const response = await POST(new Request(ENDPOINT, { method: "POST", headers: request.headers, body: padded }));
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ result: {
      content: [{ type: "text", text: "Organization Test, 0 facilities, role admin." }],
      structuredContent: { data: { organization: { id: "org-1" } } },
    } });
    expect(mocks.me).toHaveBeenCalledOnce();
  });
  it("points invalid supplier UUID issues at supplierId", async () => {
    expect(await body(await call("find_supplier_locations", { supplierId: "not-a-uuid" }))).toMatchObject({
      result: { isError: true, structuredContent: { code: "invalid_query", issues: [{ pointer: "/supplierId" }] } },
    });
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
    expect(await body(await call("find_feedstocks", args))).toMatchObject({ result: { isError: true, structuredContent: { code: "invalid_query", issues: expect.arrayContaining([expect.objectContaining({ pointer: expect.any(String) })]) } } });
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
  it.each([
    ["duplicate posting sequences", new RangeError("Duplicate sequence in stock layers")],
    ["a held layer without a code", new Error("Output bin bin layer run has no code")],
  ])("returns an internal error and logs %s for get_bin_stock", async (_finding, error) => {
    mocks.stock.mockRejectedValue(error);
    const response = await call("get_bin_stock", { storageLocation: "OB-2" });
    const payload = await body(response);
    expect(payload.error).toEqual({ code: ProtocolErrorCode.InternalError, message: "The request could not be completed." });
    expect(payload.result).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(error.message);
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
      op: "get_bin_stock", requestId: response.headers.get("x-request-id"),
      errorName: error instanceof RangeError ? "RangeError" : "Error",
    }, "API request failed");
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(error.message);
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
  for (const tool of result.tools.filter((tool: { name: string; annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint && !["find_documents", "get_document_download_url"].includes(tool.name))) {
    const operation = operations.find((candidate) => candidate.operationId === tool.name)!;
    const parameters = operation.parameters as { name: string; required: boolean; schema: Record<string, unknown> }[];
    const argumentName = (name: string) => name === "idOrCode"
      ? tool.name === "find_supplier_locations" ? "supplierId" : tool.name === "get_bin_stock" ? "storageLocation" : name
      : name;
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(parameters.map((parameter) => argumentName(parameter.name)).sort());
    for (const parameter of parameters) {
      const schema = { ...parameter.schema };
      // MCP describes its integer input independently of REST's preserved wording.
      if (parameter.name === "limit") delete schema.description;
      expect(tool.inputSchema.properties[argumentName(parameter.name)]).toMatchObject(schema);
      expect(tool.inputSchema.required?.includes(argumentName(parameter.name)) ?? false).toBe(parameter.required);
    }
  }
});

it("matches find_documents parameters to the delivery OpenAPI list", async () => {
  const { result } = await body(await POST(rpc("tools/list")));
  const tool = result.tools.find((tool: { name: string }) => tool.name === "find_documents");
  const operation = buildOpenApiDocument().paths["/deliveries/{idOrCode}/documents"].get!;
  const parameters = operation.parameters as { name: string; required: boolean; schema: Record<string, unknown> }[];
  const argumentName = (name: string) => name === "idOrCode" ? "ownerId" : name;
  expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(["ownerType", ...parameters.map(parameter => argumentName(parameter.name))].sort());
  for (const parameter of parameters) {
    const name = argumentName(parameter.name);
    expect(tool.inputSchema.required?.includes(name) ?? false).toBe(parameter.required);
    if (name === "documentType") continue;
    const schema = { ...parameter.schema };
    if (name === "limit" || name === "ownerId") delete schema.description;
    expect(tool.inputSchema.properties[name]).toMatchObject(schema);
  }
});

it("returns invalid_query for an invalid document owner type", async () => {
  expect(await body(await call("find_documents", { ownerType: "invalid", ownerId: "id" }))).toMatchObject({
    result: { isError: true, structuredContent: { code: "invalid_query", issues: [{ pointer: "/ownerType" }] } },
  });
});

it.each(["record_application", "update_application", "delete_application", "request_document_upload", "confirm_document_upload", "log_feedstock_delivery", "update_feedstock", "delete_feedstock", "record_order", "update_order", "delete_order", "record_delivery", "update_delivery"])("charges %s and dry runs as writes", async (name) => {
  for (const dryRun of [false, true]) {
    expect(mcpRequestAccess((await mocks.resolve()).ctx, { method: "tools/call", params: { name, arguments: { dryRun } } })).toBe("write");
    await call(name, { dryRun });
    expect(mocks.post).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ access: "write", writesDisabledInHandler: true }), null);
  }
});
it.each([null, [], {}, { method: "tools/list" }, { method: "tools/call", params: { name: "whoami" } }])("classifies %j as read", async (message) => {
  expect(mcpRequestAccess((await mocks.resolve()).ctx, message)).toBe("read");
});
it("answers the write switch inside MCP and keeps reads working", async () => {
  mocks.env.API_WRITES_DISABLED = true;
  const response = await call("log_feedstock_delivery");
  expect(response.status).toBe(200);
  expect(await body(response)).toMatchObject({ result: { isError: true,
    content: [{ type: "text", text: "API writes are temporarily disabled." }],
    structuredContent: { code: "api_writes_disabled", retryable: true, detail: "API writes are temporarily disabled." },
  } });
  expect((await body(await call("whoami"))).result.isError).toBeUndefined();
});
it.each([undefined, "", "a b", "é"])("reports requestKey %j at its argument path", async (requestKey) => {
  expect(await body(await call("log_feedstock_delivery", { requestKey }))).toMatchObject({
    result: { isError: true, structuredContent: {
      code: requestKey === undefined ? "idempotency_key_required" : "idempotency_key_invalid",
      issues: [{ pointer: "/requestKey" }],
    } },
  });
});
it("publishes scoped write hints and optional requestKey", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write"] } });
  const { result } = await body(await POST(rpc("tools/list")));
  expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["whoami", "log_feedstock_delivery", "update_feedstock", "request_document_upload", "confirm_document_upload"]);
  for (const tool of result.tools.filter((tool: { name: string }) => ["log_feedstock_delivery", "update_feedstock"].includes(tool.name))) {
    expect(tool.annotations).toEqual({ readOnlyHint: false, openWorldHint: false,
      destructiveHint: tool.name === "update_feedstock", idempotentHint: true });
    expect(tool.inputSchema.required).not.toContain("requestKey");
    expect(tool.inputSchema.properties.requestKey.description).toContain("Required unless dryRun is true");
  }
  expect((await body(await call("delete_feedstock"))).error).toEqual((await body(await call("unknown"))).error);
});


it("keeps write tools hidden for a read-only key", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:read"] } });
  const { result } = await body(await POST(rpc("tools/list")));
  expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["whoami", "find_feedstocks", "get_feedstock", "find_documents", "get_document_download_url"]);
  for (const name of ["log_feedstock_delivery", "update_feedstock", "delete_feedstock"]) {
    const hidden = await body(await call(name));
    expect(mocks.post).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ access: "read" }), null);
    expect(hidden.error).toEqual({ code: ProtocolErrorCode.InvalidParams, message: "Unknown tool." });
    expect(hidden.error).toEqual((await body(await call("unknown"))).error);
    expect(mcpRequestAccess((await mocks.resolve()).ctx, { method: "tools/call", params: { name } })).toBe("read");
  }
});
it("uses singular facility wording", async () => {
  const data = await mocks.me();
  data.facilities = [{ id: crypto.randomUUID(), code: "FAC-1", name: "Facility", timeZone: "UTC", today: "2026-10-09", localTime: "12:00" }];
  mocks.me.mockResolvedValue(data);
  const { result } = await body(await call("whoami"));
  expect(result.content[0].text).toContain("1 facility,");
});
it("publishes the delete annotations", async () => {
  const { result } = await body(await POST(rpc("tools/list")));
  expect(result.tools.find((tool: { name: string }) => tool.name === "delete_feedstock").annotations).toEqual({
    readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true,
  });
});

it.each([
  ["confirm_document_upload", DOCUMENT_CONFIRM_DEADLINE_MS],
  ["request_document_upload", OPERATION_DEADLINE_MS],
  ["record_application", OPERATION_DEADLINE_MS],
  ["update_application", OPERATION_DEADLINE_MS],
  ["delete_application", OPERATION_DEADLINE_MS],
] as const)("gives %s its budget without restarting it after authentication", async (name, budget) => {
  const resolution = await mocks.resolve();
  const started = Date.now();
  let now = started;
  const AUTH_DELAY_MS = 4_000;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  mocks.resolve.mockImplementation(async () => { now += AUTH_DELAY_MS; return resolution; });
  try {
    await call(name, { ownerType: "delivery" });
    expect(vi.mocked(serveMcp).mock.calls.at(-1)![1].deadlineAt).toBe(started + budget);
  } finally { clock.mockRestore(); }
});
it.each(["record_application", "update_application", "delete_application", "request_document_upload", "confirm_document_upload"])("enforces the write switch for %s", async name => {
  mocks.env.API_WRITES_DISABLED = true;
  expect(await body(await call(name, { ownerType: "delivery" }))).toMatchObject({
    result: { isError: true, structuredContent: { code: "api_writes_disabled" } },
  });
});
it("authorizes the selected document owner before executing a visible tool", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: ["deliveries:read"], organizationId: "org-1" } });
  const response = await body(await call("find_documents", { ownerType: "feedstock", ownerId: "FS-1" }));
  expect(response.result).toMatchObject({ isError: true, structuredContent: { code: "missing_scope", issues: [] } });
});
