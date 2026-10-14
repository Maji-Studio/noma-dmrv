import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ log: vi.fn(), pre: vi.fn(), post: vi.fn(), resolve: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api/guards", () => ({ preAuthGuard: mocks.pre, postAuthGuard: mocks.post }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/read-models/api-output-bin-stock", () => ({ readApiOutputBinStock: mocks.read }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log } }));
import { GET } from "./route";

const BIN_CODE = "OB-2";
const PATH = `/api/v1/storage-locations/${BIN_CODE}/stock`;
const ctx = { organizationId: "org", orgRole: "admin", scopes: ["biochar-products:read"] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pre.mockResolvedValue({ response: null, result: null });
  mocks.resolve.mockResolvedValue({ ok: true, ctx });
  mocks.post.mockResolvedValue({ ok: true, headers: new Headers() });
});

it.each([
  ["duplicate posting sequences", new RangeError("Duplicate sequence in stock layers")],
  ["a held layer without a code", new Error("Output bin bin layer run has no code")],
])("logs %s and answers a sanitized 500 problem", async (_finding, error) => {
  mocks.read.mockRejectedValue(error);
  const response = await GET(new Request(`http://localhost${PATH}`), { params: Promise.resolve({ idOrCode: BIN_CODE }) });
  expect(mocks.read).toHaveBeenCalledWith(ctx, { identifier: { code: BIN_CODE }, facilityId: undefined });
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("etag")).toBeNull();
  const body = await response.json();
  expect(body).toMatchObject({ status: 500, code: "internal_error", instance: PATH });
  expect(JSON.stringify(body)).not.toContain(error.message);
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
    op: "api.v1.storage-locations.stock.get", requestId: response.headers.get("x-request-id"),
    errorName: error instanceof RangeError ? "RangeError" : "Error",
  }, "API request failed");
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(error.message);
});
