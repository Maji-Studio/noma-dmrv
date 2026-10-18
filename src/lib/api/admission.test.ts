import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiKeyContext } from "../../../tests/helpers/api-context";
const mocks = vi.hoisted(() => ({ consume: vi.fn(), resolve: vi.fn() }));
vi.mock("@/data-access/api-rate-limits", () => ({ consumeRateLimit: mocks.consume }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/db", () => ({ db: {} }));
import { apiRoute } from "./route";
import { guardApiMethod } from "./method-not-allowed";
import { POST, GET, DELETE } from "@/app/api/mcp/route";
import { API_RATE_LIMITS } from "@/config/api-rate-limits";
const allowed = { allowed: true, limit: 600, remaining: 599, resetSeconds: 1, retryAfterSeconds: 0 };
beforeEach(() => {
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
  mocks.consume.mockReset().mockResolvedValue(allowed);
  mocks.resolve.mockReset().mockResolvedValue({ ok: true, ctx: apiKeyContext({ scopes: ["feedstocks:read"] }) });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["GET", "DELETE"])("charges only IP and admission for an authenticated MCP %s", async method => {
  const response = await (method === "GET" ? GET : DELETE)(new Request("http://localhost:3100/api/mcp", { method }));
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("POST");
  expect(mocks.consume.mock.calls.map(([bucket]) => bucket.key)).toEqual([
    expect.stringMatching(/^ip:/), "credential:credential:admit",
  ]);
});
it("challenges an unauthenticated MCP GET before the method refusal", async () => {
  mocks.resolve.mockResolvedValue({ ok: false, denial: "credential_missing" });
  const response = await GET(new Request("http://localhost:3100/api/mcp"));
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
  expect(mocks.consume).toHaveBeenCalledOnce();
});
it("debits admission on MCP OAuth step-up without charging operation buckets", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: {
    ...apiKeyContext({ scopes: ["feedstocks:read"] }),
    principal: { kind: "oauth", credentialId: "credential", userId: "user", oauthClientId: "client" },
  } });
  const response = await POST(new Request("http://localhost:3100/api/mcp", { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "log_feedstock_delivery", arguments: {} } }) }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "missing_scope" });
  expect(mocks.consume.mock.calls.map(([bucket]) => bucket.key)).toEqual([
    expect.stringMatching(/^ip:/), "credential:credential:admit",
  ]);
});
it.each(["scope", "malformed", "unknown", "method", "mcp method"])("debits admission before the %s refusal", async kind => {
  if (kind === "scope") await apiRoute("test", "feedstocks:write", vi.fn(), { audience: "rest" })(new Request("http://localhost:3100/api/v1/feedstocks"));
  if (kind === "malformed") await POST(new Request("http://localhost:3100/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "[" }));
  if (kind === "unknown") await guardApiMethod(new Request("http://localhost:3100/api/v1/unknown"));
  if (kind === "method") await guardApiMethod(new Request("http://localhost:3100/api/v1/feedstocks", { method: "PUT" }));
  if (kind === "mcp method") await GET(new Request("http://localhost:3100/api/mcp"));
  expect(mocks.consume.mock.calls[1][0]).toEqual({ key: "credential:credential:admit", capacity: 720, refillPerMinute: 720 });
});
it("stops a saturated credential before preparation", async () => {
  mocks.consume.mockResolvedValueOnce(allowed).mockResolvedValueOnce({ ...allowed, allowed: false, remaining: 0, retryAfterSeconds: 1 });
  const prepare = vi.fn();
  const response = await apiRoute("test", undefined, vi.fn(), { audience: "rest", prepare })(new Request("http://localhost:3100/api/v1/me"));
  expect(response.status).toBe(429);
  expect(prepare).not.toHaveBeenCalled();
});
it("stops saturated invalid credentials at the pre-auth bucket", async () => {
  mocks.consume.mockResolvedValue({ ...allowed, allowed: false, remaining: 0, retryAfterSeconds: 1 });
  const response = await apiRoute("test", undefined, vi.fn(), { audience: "rest" })(new Request("http://localhost:3100/api/v1/me"));
  expect(response.status).toBe(429);
  expect(mocks.consume).toHaveBeenCalledOnce();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it.each([
  { vercel: "1", ip: "160.79.104.1, 192.0.2.1", connector: true },
  { vercel: "1", ip: "160.79.112.0", connector: false },
  { vercel: "0", ip: "160.79.104.1", connector: false },
])("selects the trusted connector tier: $vercel / $ip", async ({ vercel, ip, connector }) => {
  vi.stubEnv("VERCEL", vercel);
  await apiRoute("test", undefined, async () => Response.json({}), { audience: "rest" })(new Request("http://localhost:3100/api/v1/me", { headers: { "x-forwarded-for": ip } }));
  expect(mocks.consume.mock.calls[0][0].capacity).toBe(connector ? API_RATE_LIMITS.connectorIp : API_RATE_LIMITS.ip);
});

it("reports the refusing operation bucket after admission has passed", async () => {
  mocks.consume.mockResolvedValueOnce({ ...allowed, limit: 300, remaining: 299 })
    .mockResolvedValueOnce(allowed)
    .mockResolvedValueOnce({ ...allowed, allowed: false, limit: 120, remaining: 0, resetSeconds: 60, retryAfterSeconds: 1 });
  const response = await apiRoute("test", undefined, vi.fn(), { audience: "rest" })(new Request("http://localhost:3100/api/v1/feedstocks", { method: "POST" }));
  expect(response.status).toBe(429);
  expect(response.headers.get("ratelimit-limit")).toBe("120");
  expect(response.headers.get("ratelimit-remaining")).toBe("0");
});
