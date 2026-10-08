import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { DomainError } from "@/lib/domain-errors";
import { createFeedstockResponse, mutateFeedstockResponse } from "./feedstock-mutations";
import { apiRoute } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));
// Admission is covered in route.test.ts; these cases exercise the handlers.
vi.mock("./guards", () => ({
  preAuthGuard: vi.fn(async () => null),
  postAuthGuard: vi.fn(async () => ({ ok: true, headers: new Headers() })),
}));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/data-access/api-feedstocks", () => ({ findApiFeedstock: vi.fn() }));
vi.mock("@/lib/operations/feedstocks", async () => {
  const schemas = await import("@/schemas/feedstocks");
  return {
    logFeedstockDelivery: { input: schemas.createFeedstockSchema },
    updateFeedstock: { input: schemas.updateFeedstockSchema },
    deleteFeedstock: { input: schemas.deleteFeedstockSchema },
  };
});

const START = Date.UTC(2026, 9, 8);
const AUTH_MS = OPERATION_DEADLINE_MS / 4;
const BODY_MS = OPERATION_DEADLINE_MS / 4;
const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  mocks.resolve.mockImplementation(async () => {
    vi.setSystemTime(START + AUTH_MS);
    return { ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write", "feedstocks:delete"], credentialId: "key" } };
  });
  // Stop after observing admission, before response serialization.
  mocks.run.mockRejectedValue(new DomainError("not_found", "Feedstock was not found."));
});
afterEach(() => vi.useRealTimers());

function invoke(method: "POST" | "PATCH" | "DELETE", elapsed: number) {
  const request = new Request(`https://example.test/api/v1/feedstocks/${ID}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "test-key", "if-match": '"1.1"' },
    ...(method === "DELETE" ? {} : { body: "{}" }),
  });
  if (request.body) {
    const getReader = request.body.getReader.bind(request.body);
    vi.spyOn(request.body, "getReader").mockImplementation(() => {
      vi.setSystemTime(START + elapsed);
      return getReader();
    });
  } else {
    mocks.resolve.mockImplementation(async () => {
      vi.setSystemTime(START + elapsed);
      return { ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:delete"], credentialId: "key" } };
    });
  }
  return apiRoute("test", method === "DELETE" ? "feedstocks:delete" : "feedstocks:write",
    method === "POST" ? createFeedstockResponse : (req, context) => mutateFeedstockResponse(req, context, ID, method),
  )(request);
}

it.each(["POST", "PATCH", "DELETE"] as const)("%s passes only the remaining request budget", async (method) => {
  await invoke(method, AUTH_MS + BODY_MS);
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ deadlineMs: OPERATION_DEADLINE_MS - AUTH_MS - BODY_MS });
});

it.each(["POST", "PATCH", "DELETE"] as const)("%s never starts an operation after its request budget is spent", async (method) => {
  const response = await invoke(method, OPERATION_DEADLINE_MS);
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: "deadline_exceeded", retryable: true });
  expect(mocks.run).not.toHaveBeenCalled();
});

it("does not start a POST when authentication consumes the budget", async () => {
  mocks.resolve.mockImplementation(async () => {
    vi.setSystemTime(START + OPERATION_DEADLINE_MS);
    return { ok: true, ctx: { orgRole: "admin", scopes: ["feedstocks:write"], credentialId: "key" } };
  });
  const response = await apiRoute("test", "feedstocks:write", createFeedstockResponse)(new Request(
    "https://example.test/api/v1/feedstocks", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "test-key" }, body: "{}",
    },
  ));
  expect(await response.json()).toMatchObject({ code: "deadline_exceeded", retryable: true });
  expect(mocks.run).not.toHaveBeenCalled();
});
