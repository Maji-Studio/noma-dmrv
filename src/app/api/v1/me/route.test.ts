import { beforeEach, expect, it, vi } from "vitest";
import { DatabaseError } from "pg";
import { DomainError } from "@/lib/domain-errors";
const mocks = vi.hoisted(() => ({ log: vi.fn(), pre: vi.fn(), post: vi.fn(), resolve: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api/guards", () => ({ preAuthGuard: mocks.pre, postAuthGuard: mocks.post }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/read-models/api-me", () => ({ readApiMe: mocks.read }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log } }));
import { GET } from "./route";
const request = () => new Request("http://localhost/api/v1/me");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pre.mockResolvedValue({ response: null, result: { allowed: true, limit: 300, remaining: 299, resetSeconds: 1 } });
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { credentialId: "credential" } });
  mocks.post.mockResolvedValue({ ok: true, headers: new Headers({ "RateLimit-Limit": "600", "RateLimit-Remaining": "599", "RateLimit-Reset": "1" }) });
  mocks.read.mockResolvedValue({ organization: { id: "org" } });
});
it("runs both guards and merges rate headers with private response headers", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("RateLimit-Limit")).toBe("600");
  expect(response.headers.get("RateLimit-Remaining")).toBe("599");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  expect(mocks.post).toHaveBeenCalledWith({ credentialId: "credential" }, {
    access: "read", requestId: response.headers.get("X-Request-Id"), instance: "/api/v1/me",
  }, { allowed: true, limit: 300, remaining: 299, resetSeconds: 1 });
});
it("does not resolve credentials after a pre-auth refusal", async () => {
  const refusal = new Response(null, { status: 429 });
  mocks.pre.mockResolvedValue({ response: refusal, result: null });
  expect(await GET(request())).toBe(refusal);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("does not read the model after a post-auth refusal", async () => {
  const refusal = new Response(null, { status: 429 });
  mocks.post.mockResolvedValue({ ok: false, response: refusal });
  expect(await GET(request())).toBe(refusal);
  expect(mocks.read).not.toHaveBeenCalled();
});

it("logs a resolver failure once with the response request id and no credential text", async () => {
  const marker = "test-only-credential-placeholder";
  const error = Object.assign(new Error(marker), { name: marker, code: marker, cause: new Error(marker) });
  mocks.resolve.mockRejectedValue(error);
  const response = await GET(new Request("https://example.test/api/v1/me", { headers: { authorization: `Bearer ${marker}` } }));
  expect(response.status).toBe(500);
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
    op: "api.v1.me", requestId: response.headers.get("x-request-id"), errorName: "Error",
  }, "API request failed");
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(marker);
  expect(await response.text()).not.toContain(marker);
  expect(mocks.read).not.toHaveBeenCalled();
});

it.each(["domain", "pg", "wrapped pg"])("logs only the class and code of a %s failure", async (kind) => {
  const error = kind === "domain" ? new DomainError("outcome_unknown", "test-only-sensitive-detail")
    : Object.assign(new DatabaseError("test-only-sensitive-detail", 0, "error"), { code: "08006" });
  const thrown = kind === "wrapped pg" ? new Error("test-only-sensitive-detail", { cause: error }) : error;
  mocks.resolve.mockResolvedValue({ ok: true, ctx: {} });
  mocks.read.mockRejectedValue(thrown);
  const response = await GET(new Request("https://example.test/api/v1/me"));
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
    op: "api.v1.me", requestId: response.headers.get("x-request-id"),
    errorName: kind === "domain" ? "DomainError" : "DatabaseError",
    code: kind === "domain" ? "outcome_unknown" : "08006",
  }, "API request failed");
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("test-only-sensitive-detail");
});

it("renders resolver denials and never reads organization data", async () => {
  mocks.resolve.mockResolvedValue({ ok: false, denial: "credential_owner_removed" });
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe("Bearer");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(await response.json()).toMatchObject({ code: "credential_owner_removed", instance: "/api/v1/me" });
});
it("returns the data envelope with a server-generated request id and private cache policy", async () => {
  mocks.resolve.mockResolvedValue({ ok: true, ctx: { scopes: [] } });
  mocks.read.mockResolvedValue({ organization: { id: "org", name: "Operator" }, facilities: [], scopes: [] });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ data: { organization: { id: "org", name: "Operator" }, facilities: [], scopes: [] } });
});
it("sanitizes unexpected failures", async () => {
  mocks.resolve.mockRejectedValue(new Error("private key details"));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(response.headers.get("x-request-id")).toBeTruthy();
  expect(await response.text()).not.toContain("private key details");
});
