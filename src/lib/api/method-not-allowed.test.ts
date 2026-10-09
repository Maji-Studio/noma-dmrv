import { beforeEach, expect, it, vi } from "vitest";
import { guardApiMethod } from "./method-not-allowed";
import { problemResponse } from "./problem";
import { problemSchema } from "./problem-schema";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { buildOpenApiDocument } from "./openapi/document";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), pre: vi.fn(), post: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("./guards", () => ({ preAuthGuard: mocks.pre, postAuthGuard: mocks.post }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log } }));

const rateHeaders = { "RateLimit-Limit": "120", "RateLimit-Remaining": "119", "RateLimit-Reset": "1" };
const request = (path: string, method = "PUT") => new Request(`https://example.test${path}`, { method });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pre.mockResolvedValue({ response: null, result: null });
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: ["facilities:read", "feedstocks:write"] } });
  mocks.post.mockResolvedValue({ ok: true, headers: new Headers(rateHeaders) });
});

it.each([
  ["/api/v1/facilities", "GET, HEAD, OPTIONS"],
  ["/api/v1/facilities/FAC-1", "GET, HEAD, OPTIONS"],
  ["/api/v1/feedstocks", "GET, HEAD, OPTIONS, POST"],
  ["/api/v1/feedstocks/FS-1", "DELETE, GET, HEAD, OPTIONS, PATCH"],
  ["/api/v1/me", "GET, HEAD, OPTIONS"],
])("refuses PUT on %s with the full Allow and canonical problem", async (path, allow) => {
  const response = (await guardApiMethod(request(`${path}?dryRun=true`)))!;
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe(allow);
  expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  for (const [name, value] of Object.entries(rateHeaders)) expect(response.headers.get(name)).toBe(value);
  const body = await response.json();
  expect(problemSchema.safeParse(body).success).toBe(true);
  expect(body).toEqual({
    type: "urn:noma:problem:method_not_allowed", title: "Method not allowed", status: 405,
    detail: "This method is not supported. Use a method listed in the Allow header.",
    instance: path, code: "method_not_allowed", retryable: false, errors: [],
  });
  expect(mocks.post).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ access: "read" }), null);
  const order = [mocks.pre, mocks.resolve, mocks.post].map((mock) => mock.mock.invocationCallOrder[0]);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

it.each(["DELETE", "POST", "PATCH", "PUT", "PROPFIND"])("refuses unsupported %s", async (method) => {
  expect((await guardApiMethod(request("/api/v1/facilities", method)))?.status).toBe(405);
});

it("returns the canonical 405 on every published v1 path", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: API_SCOPES } });
  for (const path of Object.keys(buildOpenApiDocument().paths)) {
    const concrete = `/api/v1${path.replace("{idOrCode}", "CODE-1.png")}`;
    const response = (await guardApiMethod(request(concrete)))!;
    expect(response.status, concrete).toBe(405);
    expect(response.headers.get("Allow")).toContain("GET");
    expect(await response.json()).toMatchObject({ code: "method_not_allowed", instance: concrete });
  }
});

it.each([
  ["/api/v1/facilities", "GET"], ["/api/v1/facilities", "HEAD"], ["/api/v1/facilities", "OPTIONS"],
  ["/api/v1/feedstocks", "POST"], ["/api/v1/feedstocks/FS-1", "PATCH"], ["/api/v1/feedstocks/FS-1", "DELETE"],
  ["/api/v1/openapi.json", "GET"], ["/api/v1/llms.txt", "HEAD"],
  ["/api/v1x/facilities", "PUT"], ["/api/mcp", "PUT"], ["/facilities", "PUT"],
])("passes through %s %s without any API admission", async (path, method) => {
  expect(await guardApiMethod(request(path, method))).toBeNull();
  expect(mocks.pre).not.toHaveBeenCalled();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});

it.each(["/api/v1/openapi.json", "/api/v1/llms.txt"])("returns public 405 for %s without auth or limits", async (path) => {
  const response = (await guardApiMethod(request(path)))!;
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  expect(await response.json()).toMatchObject({ code: "method_not_allowed" });
  expect(mocks.pre).not.toHaveBeenCalled();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});

it.each(["credential_missing", "credential_invalid", "api_access_disabled"])("returns %s before method disclosure on known and unknown paths", async (denial) => {
  mocks.resolve.mockResolvedValue({ ok: false, denial });
  for (const path of ["/api/v1/facilities", "/api/v1/unknown", "/api/v1/openapi.json/extra"]) {
    const response = (await guardApiMethod(request(path)))!;
    expect(response.status).toBe(denial === "api_access_disabled" ? 403 : 401);
    expect(response.headers.has("Allow")).toBe(false);
    expect(await response.json()).toMatchObject({ code: denial });
  }
  expect(mocks.post).not.toHaveBeenCalled();
});

it("conceals private paths without a visible operation just like unknown paths", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: [] } });
  const responses = [];
  for (const path of ["/api/v1/facilities", "/api/v1/facilities/FAC-1", "/api/v1/unknown"]) {
    const response = (await guardApiMethod(request(path)))!;
    expect(response.status).toBe(404);
    expect(response.headers.has("Allow")).toBe(false);
    const { instance, ...body } = await response.json();
    expect(instance).toBe(path);
    responses.push(body);
  }
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[0]).toEqual(responses[2]);
  expect(mocks.post).not.toHaveBeenCalled();
  expect((await guardApiMethod(request("/api/v1/me")))?.status).toBe(405);
});

it("checks role as well as scope before disclosing a method table", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "member", scopes: ["facilities:read"] } });
  expect((await guardApiMethod(request("/api/v1/facilities")))?.status).toBe(404);
  expect(mocks.post).not.toHaveBeenCalled();
});

it.each(["pre", "post"] as const)("preserves %s-auth rate refusals without Allow", async (stage) => {
  const response = problemResponse({ status: 429, code: "rate_limited", detail: "Try again later.", instance: "/api/v1/facilities", requestId: "test" });
  if (stage === "pre") mocks.pre.mockResolvedValue({ response, result: null });
  else mocks.post.mockResolvedValue({ ok: false, response });
  expect(await guardApiMethod(request("/api/v1/facilities"))).toBe(response);
  expect(response.headers.has("Allow")).toBe(false);
  if (stage === "pre") expect(mocks.resolve).not.toHaveBeenCalled();
});

it("sanitizes authentication infrastructure failures without disclosing methods", async () => {
  mocks.resolve.mockRejectedValue(new Error("private error"));
  const response = (await guardApiMethod(request("/api/v1/facilities")))!;
  expect(response.status).toBe(500);
  expect(response.headers.has("Allow")).toBe(false);
  expect(await response.text()).not.toContain("private error");
});
