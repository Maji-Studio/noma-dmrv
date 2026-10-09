import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApiContext } from "@/lib/auth/api-context";
const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  env: { NODE_ENV: "test", API_WRITES_DISABLED: false, API_FUZZ_DISABLE_RATE_LIMIT: false },
}));
vi.mock("@/config/env", () => ({ env: mocks.env }));
vi.mock("@/data-access/api-rate-limits", () => ({ consumeRateLimit: mocks.consume }));
import { preAuthGuard, postAuthGuard } from "./guards";
const ctx = { credentialId: "credential", organizationId: "organization" } as ApiContext;
const info = { requestId: "request", instance: "/api/v1/me" };
const allowed = { allowed: true, limit: 600, remaining: 599, resetSeconds: 1, retryAfterSeconds: 0 };
beforeEach(() => {
  mocks.consume.mockReset().mockResolvedValue(allowed);
  mocks.env.NODE_ENV = "test";
  mocks.env.API_WRITES_DISABLED = false;
  mocks.env.API_FUZZ_DISABLE_RATE_LIMIT = false;
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
});
afterEach(() => vi.unstubAllEnvs());
it("stops writes before any debit when disabled, while reads pass", async () => {
  mocks.env.API_WRITES_DISABLED = true;
  const result = await postAuthGuard(ctx, { ...info, access: "write" }, null);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.response.status).toBe(503);
  expect(await result.response.json()).toMatchObject({ code: "api_writes_disabled", retryable: true });
  expect(mocks.consume).not.toHaveBeenCalled();
  expect((await postAuthGuard(ctx, { ...info, access: "read" }, null)).ok).toBe(true);
});
it("charges the credential and organization and reports the tightest bucket", async () => {
  mocks.consume.mockResolvedValueOnce(allowed).mockResolvedValueOnce({ ...allowed, limit: 1200, remaining: 2, resetSeconds: 60 });
  const result = await postAuthGuard(ctx, { ...info, access: "read" }, null);
  expect(mocks.consume.mock.calls.map(([bucket]) => bucket)).toEqual([
    { key: "credential:credential:read", capacity: 600, refillPerMinute: 600 },
    { key: "organization:organization:read", capacity: 1200, refillPerMinute: 1200 },
  ]);
  if (!result.ok) throw new Error("expected success");
  expect(Object.fromEntries(result.headers)).toEqual({ "ratelimit-limit": "1200", "ratelimit-remaining": "2", "ratelimit-reset": "60" });
});
it.each([
  { bucket: "IP", ipRemaining: 1, credentialRemaining: 2, organizationRemaining: 3, limit: 300, remaining: 1, resetSeconds: 60 },
  { bucket: "credential", ipRemaining: 3, credentialRemaining: 1, organizationRemaining: 2, limit: 600, remaining: 1, resetSeconds: 30 },
  { bucket: "organization", ipRemaining: 3, credentialRemaining: 2, organizationRemaining: 1, limit: 1200, remaining: 1, resetSeconds: 15 },
])("reports the $bucket bucket when it is tightest across all three limits", async (testCase) => {
  const ip = { ...allowed, limit: 300, remaining: testCase.ipRemaining, resetSeconds: 60 };
  mocks.consume.mockResolvedValueOnce(ip)
    .mockResolvedValueOnce({ ...allowed, remaining: testCase.credentialRemaining, resetSeconds: 30 })
    .mockResolvedValueOnce({ ...allowed, limit: 1200, remaining: testCase.organizationRemaining, resetSeconds: 15 });
  const preAuth = await preAuthGuard(new Request("http://localhost"), info);
  expect(preAuth).toEqual({ response: null, result: ip });
  const result = await postAuthGuard(ctx, { ...info, access: "read" }, preAuth.result);
  if (!result.ok) throw new Error("expected success");
  expect(Object.fromEntries(result.headers)).toEqual({
    "ratelimit-limit": String(testCase.limit),
    "ratelimit-remaining": String(testCase.remaining),
    "ratelimit-reset": String(testCase.resetSeconds),
  });
  expect(mocks.consume).toHaveBeenCalledTimes(3);
});
it("uses the write budgets, including callers doing dry runs", async () => {
  await postAuthGuard(ctx, { ...info, access: "write" }, null);
  expect(mocks.consume.mock.calls.map(([bucket]) => bucket)).toEqual([
    { key: "credential:credential:write", capacity: 120, refillPerMinute: 120 },
    { key: "organization:organization:write", capacity: 240, refillPerMinute: 240 },
  ]);
});
it.each([0, 1])("returns 429 and retry headers when bucket %s refuses", async (position) => {
  if (position) mocks.consume.mockResolvedValueOnce(allowed);
  mocks.consume.mockResolvedValueOnce({ allowed: false, limit: 120, remaining: 0, resetSeconds: 60, retryAfterSeconds: 1 });
  const result = await postAuthGuard(ctx, { ...info, access: "write" }, null);
  if (result.ok) throw new Error("expected refusal");
  expect(result.response.status).toBe(429);
  expect(result.response.headers.get("Retry-After")).toBe("1");
  expect(result.response.headers.get("RateLimit-Reset")).toBe("60");
  expect(result.response.headers.get("RateLimit-Remaining")).toBe("0");
  expect(await result.response.json()).toMatchObject({ code: "rate_limited", retryable: true });
});
it("pre-auth uses the IP budget and returns the same rate-limit problem", async () => {
  mocks.consume.mockResolvedValueOnce({ ...allowed, allowed: false });
  const { response } = await preAuthGuard(new Request("http://localhost"), info);
  expect(response?.status).toBe(429);
  expect(mocks.consume).toHaveBeenCalledWith({ key: expect.stringMatching(/^ip:[a-f0-9]{64}$/), capacity: 300, refillPerMinute: 300 });
});
it("bypasses limits only outside production and never bypasses the write switch", async () => {
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  expect(await preAuthGuard(new Request("http://localhost"), info)).toEqual({ response: null, result: null });
  expect((await postAuthGuard(ctx, { ...info, access: "read" }, null)).ok).toBe(true);
  expect(mocks.consume).not.toHaveBeenCalled();
  mocks.env.API_WRITES_DISABLED = true;
  expect((await postAuthGuard(ctx, { ...info, access: "write" }, null)).ok).toBe(false);
  mocks.env.NODE_ENV = "production";
  await preAuthGuard(new Request("http://localhost"), info);
  expect(mocks.consume).toHaveBeenCalledOnce();
});

it("lets an opted-in handler answer the write switch after charging write buckets", async () => {
  mocks.env.API_WRITES_DISABLED = true;
  expect((await postAuthGuard(ctx, { ...info, access: "write", writesDisabledInHandler: true }, null)).ok).toBe(true);
  expect(mocks.consume.mock.calls.map(([bucket]) => bucket.key)).toEqual([
    "credential:credential:write", "organization:organization:write",
  ]);
});

it("bypasses all API buckets for validated hermetic fuzzing without bypassing the write switch", async () => {
  mocks.env.NODE_ENV = "production";
  mocks.env.API_FUZZ_DISABLE_RATE_LIMIT = true;
  expect(await preAuthGuard(new Request("http://localhost"), info)).toEqual({ response: null, result: null });
  for (const access of ["read", "write"] as const) {
    expect((await postAuthGuard(ctx, { ...info, access }, null)).ok).toBe(true);
  }
  expect(mocks.consume).not.toHaveBeenCalled();
  mocks.env.API_WRITES_DISABLED = true;
  const result = await postAuthGuard(ctx, { ...info, access: "write" }, null);
  if (result.ok) throw new Error("expected refusal");
  expect(result.response.status).toBe(503);
  expect(mocks.consume).not.toHaveBeenCalled();
});
