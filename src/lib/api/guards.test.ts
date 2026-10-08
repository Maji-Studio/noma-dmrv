import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApiContext } from "@/lib/auth/api-context";
const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  env: { NODE_ENV: "test", API_WRITES_DISABLED: false },
}));
vi.mock("@/config/env", () => ({ env: mocks.env }));
vi.mock("@/data-access/api-rate-limits", () => ({ consumeRateLimit: mocks.consume }));
import { preAuthGuard, postAuthGuard } from "./guards";
const ctx = { credentialId: "credential", organizationId: "organization" } as ApiContext;
const info = { requestId: "request", instance: "/api/v1/me" };
const allowed = { allowed: true, limit: 600, remaining: 599, resetSeconds: 1 };
beforeEach(() => {
  mocks.consume.mockReset().mockResolvedValue(allowed);
  mocks.env.NODE_ENV = "test";
  mocks.env.API_WRITES_DISABLED = false;
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
});
afterEach(() => vi.unstubAllEnvs());
it("stops writes before any debit when disabled, while reads pass", async () => {
  mocks.env.API_WRITES_DISABLED = true;
  const result = await postAuthGuard(ctx, { ...info, access: "write" });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected refusal");
  expect(result.response.status).toBe(503);
  expect(await result.response.json()).toMatchObject({ code: "api_writes_disabled", retryable: true });
  expect(mocks.consume).not.toHaveBeenCalled();
  expect((await postAuthGuard(ctx, { ...info, access: "read" })).ok).toBe(true);
});
it("charges the credential and organization and reports the tightest bucket", async () => {
  mocks.consume.mockResolvedValueOnce(allowed).mockResolvedValueOnce({ ...allowed, limit: 1200, remaining: 2, resetSeconds: 60 });
  const result = await postAuthGuard(ctx, { ...info, access: "read" });
  expect(mocks.consume.mock.calls.map(([bucket]) => bucket)).toEqual([
    { key: "credential:credential:read", capacity: 600, refillPerMinute: 600 },
    { key: "organization:organization:read", capacity: 1200, refillPerMinute: 1200 },
  ]);
  if (!result.ok) throw new Error("expected success");
  expect(Object.fromEntries(result.headers)).toEqual({ "ratelimit-limit": "1200", "ratelimit-remaining": "2", "ratelimit-reset": "60" });
});
it("uses the write budgets, including callers doing dry runs", async () => {
  await postAuthGuard(ctx, { ...info, access: "write" });
  expect(mocks.consume.mock.calls.map(([bucket]) => bucket)).toEqual([
    { key: "credential:credential:write", capacity: 120, refillPerMinute: 120 },
    { key: "organization:organization:write", capacity: 240, refillPerMinute: 240 },
  ]);
});
it.each([0, 1])("returns 429 and retry headers when bucket %s refuses", async (position) => {
  if (position) mocks.consume.mockResolvedValueOnce(allowed);
  mocks.consume.mockResolvedValueOnce({ allowed: false, limit: 120, remaining: 0, resetSeconds: 60 });
  const result = await postAuthGuard(ctx, { ...info, access: "write" });
  if (result.ok) throw new Error("expected refusal");
  expect(result.response.status).toBe(429);
  expect(result.response.headers.get("Retry-After")).toBe("60");
  expect(result.response.headers.get("RateLimit-Remaining")).toBe("0");
  expect(await result.response.json()).toMatchObject({ code: "rate_limited", retryable: true });
});
it("pre-auth uses the IP budget and returns the same rate-limit problem", async () => {
  mocks.consume.mockResolvedValueOnce({ ...allowed, allowed: false });
  const response = await preAuthGuard(new Request("http://localhost"), info);
  expect(response?.status).toBe(429);
  expect(mocks.consume).toHaveBeenCalledWith({ key: expect.stringMatching(/^ip:[a-f0-9]{64}$/), capacity: 300, refillPerMinute: 300 });
});
it("bypasses limits only outside production and never bypasses the write switch", async () => {
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  expect(await preAuthGuard(new Request("http://localhost"), info)).toBeNull();
  expect((await postAuthGuard(ctx, { ...info, access: "read" })).ok).toBe(true);
  expect(mocks.consume).not.toHaveBeenCalled();
  mocks.env.API_WRITES_DISABLED = true;
  expect((await postAuthGuard(ctx, { ...info, access: "write" })).ok).toBe(false);
  mocks.env.NODE_ENV = "production";
  await preAuthGuard(new Request("http://localhost"), info);
  expect(mocks.consume).toHaveBeenCalledOnce();
});
