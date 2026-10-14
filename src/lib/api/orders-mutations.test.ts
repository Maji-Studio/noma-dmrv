import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { DomainError } from "@/lib/domain-errors";
import { createOrderResponse, mutateOrderResponse } from "./orders-mutations";
import { apiRoute } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), run: vi.fn(), admission: vi.fn(async () => ({ ok: true, headers: new Headers() })) }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));
// Admission is covered in route.test.ts; these cases exercise the handlers.
vi.mock("./guards", () => ({
  preAuthGuard: vi.fn(async () => ({ response: null, result: null })),
  postAuthGuard: mocks.admission,
}));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/data-access/orders", () => ({}));
vi.mock("@/data-access/organization-settings", () => ({}));
vi.mock("@/data-access/transport-legs", () => ({}));
vi.mock("@/data-access/feedstocks", () => ({}));
vi.mock("@/lib/read-models/api-feedstocks", () => ({ readApiFeedstock: vi.fn() }));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/data-access/storage-object-deletions", () => ({}));
vi.mock("@/lib/read-models/api-orders", () => ({ readApiOrder: vi.fn() }));

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
    return { ok: true, ctx: { orgRole: "admin", scopes: ["orders:write", "orders:delete"], credentialId: "key" } };
  });
  // Stop after observing admission, before response serialization.
  mocks.run.mockRejectedValue(new DomainError("not_found", "Order was not found."));
});
afterEach(() => vi.useRealTimers());

/** The body read takes `elapsed` of the request budget, as a slow upload would. */
function invoke(method: "POST" | "PATCH" | "DELETE", elapsed: number) {
  const request = new Request(`https://example.test/api/v1/orders/${ID}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "test-key", "if-match": '"1.1"' },
    body: "{}",
  });
  const getReader = request.body!.getReader.bind(request.body!);
  vi.spyOn(request.body!, "getReader").mockImplementation(() => {
    vi.setSystemTime(START + elapsed);
    return getReader();
  });
  return apiRoute("test", method === "DELETE" ? "orders:delete" : "orders:write",
    method === "POST" ? createOrderResponse : (req, context) => mutateOrderResponse(req, context, ID, method),
  )(request);
}

it.each(["POST", "PATCH", "DELETE"] as const)("%s passes only the budget left after the body is read", async (method) => {
  await invoke(method, AUTH_MS + BODY_MS);
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.admission).toHaveBeenCalledOnce();
  expect(mocks.admission.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ access: "write" })]));
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ deadlineMs: OPERATION_DEADLINE_MS - AUTH_MS - BODY_MS });
});

