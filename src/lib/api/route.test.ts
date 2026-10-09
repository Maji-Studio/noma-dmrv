import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { ApiHttpError } from "./http-error";
import { problemResponse } from "./problem";
import { apiRoute } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), log: vi.fn(), pre: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("./guards", () => ({ preAuthGuard: mocks.pre, postAuthGuard: mocks.post }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log } }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pre.mockResolvedValue({ response: null, result: null });
  mocks.post.mockResolvedValue({ ok: true, headers: new Headers(rateHeaders) });
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write"] } });
});
const rateHeaders = { "RateLimit-Limit": "120", "RateLimit-Remaining": "119", "RateLimit-Reset": "1" };
const request = () => new Request("https://example.test/api/v1/feedstocks?dryRun=true");
it.each([
  { orgRole: "admin", scopes: [] }, { orgRole: "member", scopes: ["feedstocks:write"] },
])("refuses missing scope or role before invoking the handler", async (ctx) => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx });
  const handler = vi.fn();
  const response = await apiRoute("test", "feedstocks:write", handler)(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "missing_scope", instance: "/api/v1/feedstocks" });
  expect(handler).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("converts domain issues using action failures and escapes JSON Pointers", async () => {
  const route = apiRoute("test", "feedstocks:write", async () => {
    throw new DomainError("validation_failed", "Remove unrecognized properties.", {
      issues: [{ path: ["allocations", 0, "a/b~"], code: "unknown_field", message: "Unknown property." }],
    });
  });
  const response = await route(request());
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ errors: [{ pointer: "/allocations/0/a~1b~0", code: "unknown_field" }] });
  expect(mocks.log).not.toHaveBeenCalled();
});
it("logs domain infrastructure failures once without the action converter's raw cause", async () => {
  const marker = "do-not-log-this-value";
  const route = apiRoute("test", "feedstocks:write", async () => {
    throw new DomainError("outcome_unknown", marker, { cause: new Error(marker) });
  });
  const response = await route(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: "outcome_unknown", retryable: true });
  expect(mocks.log).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(marker);
});
it("applies request headers even to an empty successful response", async () => {
  const response = await apiRoute("test", "feedstocks:write", async () => new Response(null, { status: 204 }))(request());
  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toBeTruthy();
});

it("records the absolute deadline before authentication", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.UTC(2026, 9, 8);
  vi.setSystemTime(start);
  mocks.pre.mockImplementation(async () => {
    vi.setSystemTime(start + OPERATION_DEADLINE_MS / 2);
    return { response: null, result: null };
  });
  mocks.resolve.mockImplementation(async () => {
    vi.setSystemTime(start + OPERATION_DEADLINE_MS - 1);
    return { ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write"] } };
  });
  const handler = vi.fn(async () => new Response(null, { status: 204 }));
  await apiRoute("test", "feedstocks:write", handler)(request());
  expect(handler.mock.calls[0]).toBeDefined();
  expect(handler).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ deadlineAt: start + OPERATION_DEADLINE_MS }), {});
});
it.each(["GET", "HEAD", "POST", "PATCH", "DELETE"])("refuses %s before its handler when authentication exhausts the budget", async (method) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.UTC(2026, 9, 8);
  vi.setSystemTime(start);
  mocks.resolve.mockImplementation(async () => {
    vi.setSystemTime(start + OPERATION_DEADLINE_MS);
    return { ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write"] } };
  });
  const handler = vi.fn(async () => new Response(null, { status: 204 }));
  const response = await apiRoute("test", "feedstocks:write", handler)(new Request(request(), { method }));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: "deadline_exceeded", retryable: true });
  expect(handler).not.toHaveBeenCalled();
  for (const [name, value] of Object.entries(rateHeaders)) expect(response.headers.get(name)).toBe(value);
});
afterEach(() => vi.useRealTimers());


it("runs pre-auth, credential resolution, post-auth and handler in order", async () => {
  const handler = vi.fn(async () => new Response(null, { status: 204 }));
  await apiRoute("test", "feedstocks:write", handler)(request());
  const order = [mocks.pre, mocks.resolve, mocks.post, handler].map((mock) => mock.mock.invocationCallOrder[0]);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(mocks.pre).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ instance: "/api/v1/feedstocks", requestId: expect.any(String) }));
});

it("returns a pre-auth 429 without resolving credentials", async () => {
  const refusal = new Response(null, { status: 429 });
  mocks.pre.mockResolvedValue({ response: refusal, result: null });
  const handler = vi.fn();
  expect(await apiRoute("test", undefined, handler)(request())).toBe(refusal);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

it("returns a post-auth denial without invoking the handler", async () => {
  const refusal = new Response(null, { status: 503 });
  mocks.post.mockResolvedValue({ ok: false, response: refusal });
  const handler = vi.fn();
  expect(await apiRoute("test", undefined, handler)(request())).toBe(refusal);
  expect(handler).not.toHaveBeenCalled();
});

it.each([
  ["GET", "read"], ["HEAD", "read"], ["POST", "write"], ["PATCH", "write"], ["DELETE", "write"],
])("treats %s as %s even with dryRun=true and no scope", async (method, access) => {
  await apiRoute("test", undefined, async () => new Response(null))(
    new Request(request(), { method }),
  );
  expect(mocks.post).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ access }), null);
});

it.each(["success", "returned problem", "http error", "domain error", "unexpected error"])(
  "merges rate-limit headers on %s after admission", async (kind) => {
    const response = await apiRoute("test", undefined, async (_request, context) => {
      if (kind === "http error") throw new ApiHttpError(400, "bad_request", "Bad request.");
      if (kind === "domain error") throw new DomainError("validation_failed", "Invalid input.");
      if (kind === "unexpected error") throw new Error("Unexpected failure");
      if (kind === "returned problem") return problemResponse({ status: 422, code: "validation_failed", detail: "Invalid input.", ...context });
      return new Response(null, { status: 204, headers: { ETag: '"1.1"' } });
    })(request());
    for (const [name, value] of Object.entries(rateHeaders)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    if (kind === "success") expect(response.headers.get("etag")).toBe('"1.1"');
    else expect(response.headers.get("content-type")).toContain("application/problem+json");
  },
);


it("prepares once after authentication and passes the replacement request to the handler", async () => {
  const original = request();
  const replacement = new Request(original, { method: "POST", body: "prepared" });
  const prepare = vi.fn(async () => ({ request: replacement, access: "read" as const }));
  const handler = vi.fn(async (received: Request) => new Response(await received.text()));
  const response = await apiRoute("test", undefined, handler, { prepare })(original);
  expect(await response.text()).toBe("prepared");
  expect(prepare).toHaveBeenCalledExactlyOnceWith(original, expect.objectContaining({
    ctx: { orgRole: "admin", scopes: ["feedstocks:write"] },
  }));
  expect(handler).toHaveBeenCalledWith(replacement, expect.any(Object), {});
  expect(mocks.post).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ access: "read" }), null);
  const order = [mocks.resolve, prepare, mocks.post, handler].map((mock) => mock.mock.invocationCallOrder[0]);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

it("does not prepare an unauthenticated request", async () => {
  mocks.resolve.mockResolvedValue({ ok: false, denial: "credential_missing" });
  const prepare = vi.fn();
  const handler = vi.fn();
  const response = await apiRoute("test", undefined, handler, { prepare })(request());
  expect(response.status).toBe(401);
  expect(prepare).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});


it("preserves query validation issue pointers in 400 responses", async () => {
  const { parseApiQuery } = await import("./query");
  const { lookupListSchema } = await import("./query-schemas");
  const handler = apiRoute("test", undefined, async (req) => {
    parseApiQuery(req, lookupListSchema);
    return Response.json({});
  });
  const response = await handler(new Request("https://example.test/api/v1/facilities?q=bad%00value"));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "validation_failed", errors: [{ pointer: "/q", code: "custom" }] });
});
