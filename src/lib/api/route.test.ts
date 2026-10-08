import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { apiRoute } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log } }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write"] } });
});
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
  mocks.resolve.mockImplementation(async () => {
    vi.setSystemTime(start + OPERATION_DEADLINE_MS);
    return { ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write"] } };
  });
  const handler = vi.fn(async () => new Response(null, { status: 204 }));
  await apiRoute("test", "feedstocks:write", handler)(request());
  expect(handler.mock.calls[0]).toBeDefined();
  expect(handler).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ deadlineAt: start + OPERATION_DEADLINE_MS }), {});
});
afterEach(() => vi.useRealTimers());
