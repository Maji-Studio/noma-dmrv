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
  preAuthGuard: vi.fn(async () => ({ response: null, result: null })),
  postAuthGuard: vi.fn(async () => ({ ok: true, headers: new Headers() })),
}));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/lib/read-models/api-feedstocks", () => ({ readApiFeedstock: vi.fn() }));
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

function deleteRequest(body?: BodyInit, contentType = "application/json") {
  return new Request(`https://example.test/api/v1/feedstocks/${ID}`, {
    method: "DELETE", headers: { "content-type": contentType, "if-match": '"1.1"' },
    ...(body === undefined ? {} : { body, duplex: "half" }),
  } as RequestInit);
}
const deleteRoute = apiRoute("test", "feedstocks:delete", (request, context) =>
  mutateFeedstockResponse(request, context, ID, "DELETE"));

it.each([undefined, "{}"])("accepts the empty DELETE contract (%s)", async (body) => {
  await deleteRoute(deleteRequest(body));
  expect(mocks.run).toHaveBeenCalledOnce();
});

it("rejects every DELETE property with escaped pointers before running the operation", async () => {
  const response = await deleteRoute(deleteRequest(JSON.stringify({ dryRun: true, "a/b~": true })));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: "validation_failed", errors: [
    { pointer: "/dryRun", code: "unknown_field" }, { pointer: "/a~1b~0", code: "unknown_field" },
  ] });
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(["null", "[]", "true", '"text"'])("rejects non-object DELETE body %s", async (body) => {
  expect((await deleteRoute(deleteRequest(body))).status).toBe(422);
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([
  ["{}", "text/plain", 415, "unsupported_media_type"],
  ["{", "application/json", 400, "malformed_json"],
] as const)("validates DELETE media and JSON (%s)", async (body, media, status, code) => {
  const response = await deleteRoute(deleteRequest(body, media));
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code });
  expect(mocks.run).not.toHaveBeenCalled();
});

it("bounds a streamed DELETE body before running the operation", async () => {
  const { API_BODY_MAX_BYTES } = await import("@/config/api-rest");
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(API_BODY_MAX_BYTES));
    controller.enqueue(new Uint8Array(1));
    controller.close();
  } });
  const response = await deleteRoute(deleteRequest(body));
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ code: "payload_too_large" });
  expect(mocks.run).not.toHaveBeenCalled();
});

it("accepts a create idempotency key on a dry run", async () => {
  const response = await apiRoute("test", "feedstocks:write", createFeedstockResponse)(new Request(
    "https://example.test/api/v1/feedstocks?dryRun=true", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "dry-run-key" }, body: "{}",
    },
  ));
  // The mocked operation stops after admission. This proves the adapter accepts
  // the key and forwards dryRun rather than rejecting the header.
  expect(response.status).toBe(404);
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: { key: "dry-run-key" } });
});

it.each(["PATCH", "DELETE"] as const)("%s rejects a NUL target before running the operation", async (method) => {
  const response = await apiRoute("test", method === "DELETE" ? "feedstocks:delete" : "feedstocks:write", (req, context) =>
    mutateFeedstockResponse(req, context, "bad\u0000id", method))(new Request("https://example.test/api/v1/feedstocks/bad%00id", {
    method, headers: { "if-match": '\"1.1\"' },
  }));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "not_found" });
  expect(mocks.run).not.toHaveBeenCalled();
});
