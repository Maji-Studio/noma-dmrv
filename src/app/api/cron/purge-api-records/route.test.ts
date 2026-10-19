import { randomBytes } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  env: { CRON_SECRET: undefined as string | undefined },
  records: vi.fn(), buckets: vi.fn(), log: vi.fn(), attempts: vi.fn(), pending: vi.fn(), tokens: vi.fn(), assertions: vi.fn(),
}));
vi.mock("@/config/env", () => ({ env: mocks.env }));
vi.mock("@/data-access/api-idempotency-records", () => ({ purgeExpiredIdempotencyRecords: mocks.records }));
vi.mock("@/data-access/api-rate-limits", () => ({ purgeIdleRateLimitBuckets: mocks.buckets }));
vi.mock("@/data-access/oauth-purge", () => ({
  purgeExpiredOAuthAttempts: mocks.attempts, purgePendingOAuthGrants: mocks.pending,
  purgeExpiredOAuthTokens: mocks.tokens, purgeExpiredOAuthClientAssertions: mocks.assertions,
}));
vi.mock("@/lib/log", () => ({ logger: { info: mocks.log } }));
import { GET } from "./route";
const request = (authorization?: string) => new Request("http://localhost/api/cron/purge-api-records", {
  headers: authorization ? { authorization } : {},
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.CRON_SECRET = randomBytes(32).toString("hex");
  mocks.records.mockResolvedValue(3);
  mocks.buckets.mockResolvedValue(2);
  mocks.attempts.mockResolvedValue(4); mocks.pending.mockResolvedValue(1);
  mocks.tokens.mockResolvedValue({ accessTokens: 6, refreshTokens: 5 }); mocks.assertions.mockResolvedValue(7);
});
it.each([undefined, "Bearer wrong", "Basic wrong"])("refuses %s without detail or purging", async (header) => {
  const response = await GET(request(header));
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("");
  expect(mocks.records).not.toHaveBeenCalled();
  expect(mocks.buckets).not.toHaveBeenCalled();
  for (const purge of [mocks.attempts, mocks.pending, mocks.tokens, mocks.assertions]) expect(purge).not.toHaveBeenCalled();
});
it("fails closed when unconfigured", async () => {
  mocks.env.CRON_SECRET = undefined;
  expect((await GET(request())).status).toBe(503);
  expect(mocks.records).not.toHaveBeenCalled();
  expect(mocks.buckets).not.toHaveBeenCalled();
  for (const purge of [mocks.attempts, mocks.pending, mocks.tokens, mocks.assertions]) expect(purge).not.toHaveBeenCalled();
});
it("purges with the same clock and reports only counts", async () => {
  const response = await GET(request(`Bearer ${mocks.env.CRON_SECRET}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ idempotencyRecords: 3, rateLimitBuckets: 2, oauthAttempts: 4, oauthPendingGrants: 1, oauthTokens: { accessTokens: 6, refreshTokens: 5 }, oauthClientAssertions: 7 });
  expect(mocks.records.mock.calls[0][0]).toBeInstanceOf(Date);
  for (const purge of [mocks.attempts, mocks.pending, mocks.tokens, mocks.assertions]) expect(purge.mock.calls[0][0]).toBe(mocks.records.mock.calls[0][0]);
  expect(mocks.buckets.mock.calls[0][0]).toBe(mocks.records.mock.calls[0][0]);
  expect(mocks.log).toHaveBeenCalledWith({ idempotencyRecords: 3, rateLimitBuckets: 2, oauthAttempts: 4, oauthPendingGrants: 1, oauthTokens: { accessTokens: 6, refreshTokens: 5 }, oauthClientAssertions: 7 }, "API records purged");
});
