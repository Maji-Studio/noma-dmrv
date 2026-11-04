import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { API_RATE_LIMITS } from "@/config/api-rate-limits";

const mocks = vi.hoisted(() => ({ consume: vi.fn(), handler: vi.fn() }));
vi.mock("@/data-access/api-rate-limits", () => ({ consumeRateLimit: mocks.consume }));
vi.mock("@/lib/auth/better-auth", () => ({ auth: { handler: mocks.handler } }));

beforeEach(() => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true");
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", "");
  vi.stubEnv("DISABLE_RATE_LIMIT", "false");
  vi.stubEnv("VERCEL", "1");
  vi.resetModules();
  mocks.consume.mockReset().mockResolvedValue({ allowed: true, limit: 300, remaining: 299, resetSeconds: 60, retryAfterSeconds: 0 });
  mocks.handler.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
});
afterEach(() => vi.unstubAllEnvs());

it.each(["GET", "POST"] as const)("charges a %s OAuth request once before dispatch", async method => {
  const route = await import("@/app/api/auth/[...all]/route");
  const request = new Request("https://noma.example.com/api/auth/oauth2/consent", { method });
  expect((await route[method](request)).status).toBe(200);
  expect(mocks.consume).toHaveBeenCalledOnce();
  expect(mocks.handler).toHaveBeenCalledWith(request);
  expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(mocks.handler.mock.invocationCallOrder[0]);
  expect(route.maxDuration).toBe(30);
});

it.each([
  { ip: "160.79.104.1", limit: API_RATE_LIMITS.connectorIp },
  { ip: "160.79.112.0", limit: API_RATE_LIMITS.ip },
])("uses the bounded IP tier for $ip", async ({ ip, limit }) => {
  const { POST } = await import("@/app/api/auth/[...all]/route");
  await POST(new Request("https://noma.example.com/api/auth/oauth2/token", { method: "POST", headers: { "x-forwarded-for": ip } }));
  expect(mocks.consume).toHaveBeenCalledWith({ key: expect.stringMatching(/^oauth-ip:[a-f0-9]{64}$/), capacity: limit, refillPerMinute: limit });
});

it("does not trust forwarded connector IPs outside Vercel", async () => {
  vi.stubEnv("VERCEL", "0");
  const { GET } = await import("@/app/api/auth/[...all]/route");
  await GET(new Request("https://noma.example.com/api/auth/oauth2/authorize", { headers: { "x-forwarded-for": "160.79.104.1" } }));
  expect(mocks.consume.mock.calls[0][0].capacity).toBe(300);
});

it("stops exhausted IPs before Better Auth", async () => {
  mocks.consume.mockResolvedValue({ allowed: false, limit: 300, remaining: 0, resetSeconds: 60, retryAfterSeconds: 1 });
  const { POST } = await import("@/app/api/auth/[...all]/route");
  const response = await POST(new Request("https://noma.example.com/api/auth/oauth2/consent", { method: "POST" }));
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("1");
  expect(response.headers.get("ratelimit-limit")).toBe("300");
  expect(mocks.handler).not.toHaveBeenCalled();
});

it.each(["/api/auth/sign-in/email", "/api/auth/oauth2x/token", "/api/auth/oauth2"])("does not charge %s", async path => {
  const { GET } = await import("@/app/api/auth/[...all]/route");
  await GET(new Request(`https://noma.example.com${path}`));
  expect(mocks.consume).not.toHaveBeenCalled();
});

it("keeps connector API exhaustion separate from OAuth refreshes", async () => {
  mocks.consume.mockImplementation(async ({ key }: { key: string }) => ({
    allowed: key.startsWith("oauth-ip:"), limit: 300, remaining: 0, resetSeconds: 60, retryAfterSeconds: 1,
  }));
  const { preAuthGuard } = await import("@/lib/api/guards");
  const request = new Request("https://noma.example.com/api/auth/oauth2/token", { method: "POST" });
  expect((await preAuthGuard(request, { requestId: "test", instance: "/api/v1" })).response?.status).toBe(429);
  const { POST } = await import("@/app/api/auth/[...all]/route");
  expect((await POST(request)).status).toBe(200);
});
