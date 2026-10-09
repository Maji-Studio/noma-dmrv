import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import proxy, { config } from "./proxy";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/api/method-not-allowed", () => ({ guardApiMethod: mocks.guard }));
vi.mock("@/lib/auth/middleware", () => ({ updateSession: mocks.session }));

beforeEach(() => vi.resetAllMocks());

it.each(["/api/v1/facilities/FAC-1.png", "/api/v1/feedstocks/FS-1.woff", "/api/v1/openapi.json", "/api/v1/llms.txt"])(
  "runs the proxy on v1 path %s even when it ends in a file extension", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  },
);

it.each(["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/image.png", "/api/v1x/image.png"])(
  "keeps the existing matcher exclusion for %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  },
);

it("returns a method refusal without consulting session auth", async () => {
  const refusal = new Response(null, { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
  mocks.guard.mockResolvedValue(refusal);
  const request = new NextRequest("https://example.test/api/v1/facilities", { method: "PUT" });
  expect(await proxy(request)).toBe(refusal);
  expect(mocks.guard).toHaveBeenCalledExactlyOnceWith(request);
  expect(mocks.session).not.toHaveBeenCalled();
});

it.each(["/api/v1/facilities", "/facilities", "/api/v1x/facilities"])(
  "preserves session middleware results when the method guard passes %s through", async (path) => {
    const response = NextResponse.next();
    mocks.guard.mockResolvedValue(null);
    mocks.session.mockResolvedValue(response);
    const request = new NextRequest(`https://example.test${path}`);
    expect(await proxy(request)).toBe(response);
    expect(mocks.session).toHaveBeenCalledExactlyOnceWith(request);
  },
);
