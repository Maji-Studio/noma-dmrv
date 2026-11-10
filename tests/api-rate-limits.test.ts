/** DB suite: PostgreSQL 18, with enough connections for competing debits. */
import { afterEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
vi.hoisted(() => { process.env.DB_POOL_MAX = "8"; });
import { db } from "@/db";
import { apiRateLimitBuckets } from "@/db/schema";
import { consumeRateLimit, refundRateLimit } from "@/data-access/api-rate-limits";
import { clientIpBucketKey } from "@/lib/api/client-ip";

const keys: string[] = [];
const NOW = new Date("2026-10-08T12:00:00Z");
const CAPACITY = 3;
const CONCURRENT_DEBITS = 12;
const SINGLE_TOKEN = 1;
const COOLDOWN_MS = 60_000;
const AFTER_COOLDOWN_MS = COOLDOWN_MS + 1_000;
const REFUSED_CONSUME_DELAY_MS = 10_000;
const REFUND_DELAY_MS = 11_000;
const RETRY_DELAY_MS = 12_000;
function bucket() {
  const key = `credential:${crypto.randomUUID()}:write`;
  keys.push(key);
  return { key, capacity: CAPACITY, refillPerMinute: CAPACITY };
}
afterEach(async () => {
  if (keys.length) await db.delete(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, keys.splice(0)));
});
it("allows capacity, refuses without debiting, then refills with an injected clock", async () => {
  const target = bucket();
  for (let remaining = CAPACITY - 1; remaining >= 0; remaining--) {
    expect(await consumeRateLimit(target, 1, NOW)).toMatchObject({ allowed: true, remaining, limit: CAPACITY });
  }
  expect(await consumeRateLimit(target, 1, NOW)).toEqual({ allowed: false, debitRefilledAt: expect.any(String), debitTokens: 0, remaining: 0, limit: CAPACITY, resetSeconds: 60, retryAfterSeconds: 20 });
  expect(await consumeRateLimit(target, 1, new Date(NOW.getTime() + 20_000))).toMatchObject({ allowed: true, remaining: 0 });
  expect(await consumeRateLimit(target, 1, new Date(NOW.getTime() + 120_000))).toMatchObject({ allowed: true, remaining: 2 });
});
it("does not award refill twice when the clock moves backwards", async () => {
  const target = bucket();
  await consumeRateLimit(target, CAPACITY, NOW);
  // Refill resumes at the retained timestamp: a minute away, then a minute to fill.
  expect(await consumeRateLimit(target, 1, new Date(NOW.getTime() - 60_000))).toMatchObject({ allowed: false, resetSeconds: 120, retryAfterSeconds: 80 });
  expect(await consumeRateLimit(target, 1, NOW)).toMatchObject({ allowed: false, remaining: 0 });
});
it("concurrent debits on parallel pool connections never overspend", async () => {
  expect(db.$client.options.max).toBeGreaterThan(1);
  const target = bucket();
  const results = await Promise.all(Array.from({ length: CONCURRENT_DEBITS }, () => consumeRateLimit(target, 1, NOW)));
  expect(results.filter((result) => result.allowed)).toHaveLength(CAPACITY);
  expect(results.every((result) => result.remaining >= 0)).toBe(true);
  const [row] = await db.select().from(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, target.key));
  expect(row.tokens).toBe(0);
});
it("refunds an empty bucket so an immediate consume is allowed", async () => {
  const target = bucket();
  const debit = await consumeRateLimit(target, CAPACITY, NOW);
  expect(await consumeRateLimit(target, 1, NOW)).toMatchObject({ allowed: false });

  await refundRateLimit(target, { refilledAt: debit.debitRefilledAt, tokens: debit.debitTokens }, 1, NOW);

  const [row] = await db.select().from(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, target.key));
  expect(row.tokens).toBe(1);
  expect(row.refilledAt).toEqual(NOW);
  expect(await consumeRateLimit(target, 1, NOW)).toMatchObject({ allowed: true, remaining: 0 });
});
it("caps refunds at capacity, including concurrent refunds on a full bucket", async () => {
  const target = bucket();
  const debit = await consumeRateLimit(target, CAPACITY, NOW);
  const reservation = { refilledAt: debit.debitRefilledAt, tokens: debit.debitTokens };
  await refundRateLimit(target, reservation, CAPACITY, NOW);

  await Promise.all(Array.from({ length: CONCURRENT_DEBITS }, () => refundRateLimit(target, reservation, 1, NOW)));

  const [row] = await db.select().from(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, target.key));
  expect(row.tokens).toBe(CAPACITY);
  expect(row.refilledAt).toEqual(NOW);
});
it("does not create a missing bucket when refunding", async () => {
  const target = bucket();

  await refundRateLimit(target, { refilledAt: NOW.toISOString(), tokens: 0 }, 1, NOW);

  expect(await db.select().from(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, target.key))).toEqual([]);
});
it("refunds a debit after an intervening refused consume snapshots accrual", async () => {
  const target = { ...bucket(), capacity: SINGLE_TOKEN, refillPerMinute: SINGLE_TOKEN };
  const debit = await consumeRateLimit(target, SINGLE_TOKEN, NOW);
  expect(debit).toMatchObject({ allowed: true, debitTokens: 0 });
  expect(await consumeRateLimit(target, SINGLE_TOKEN, new Date(NOW.getTime() + REFUSED_CONSUME_DELAY_MS)))
    .toMatchObject({ allowed: false, remaining: 0 });

  await refundRateLimit(
    target,
    { refilledAt: debit.debitRefilledAt, tokens: debit.debitTokens },
    SINGLE_TOKEN,
    new Date(NOW.getTime() + REFUND_DELAY_MS),
  );

  expect(await consumeRateLimit(target, SINGLE_TOKEN, new Date(NOW.getTime() + RETRY_DELAY_MS)))
    .toMatchObject({ allowed: true, remaining: 0 });
});
it("does not refund an older debit after a refilled bucket is consumed again", async () => {
  const target = { ...bucket(), capacity: SINGLE_TOKEN, refillPerMinute: SINGLE_TOKEN };
  const firstDebit = await consumeRateLimit(target, 1, NOW);
  expect(firstDebit.allowed).toBe(true);
  expect(await consumeRateLimit(target, 1, new Date(NOW.getTime() + COOLDOWN_MS)))
    .toMatchObject({ allowed: true, remaining: 0 });

  await refundRateLimit(
    target,
    { refilledAt: firstDebit.debitRefilledAt, tokens: firstDebit.debitTokens },
    SINGLE_TOKEN,
    new Date(NOW.getTime() + COOLDOWN_MS),
  );

  expect(await consumeRateLimit(target, 1, new Date(NOW.getTime() + AFTER_COOLDOWN_MS)))
    .toMatchObject({ allowed: false, remaining: 0 });
});
it("stores a hash and never the raw client IP", async () => {
  const ip = "192.0.2.123";
  const key = clientIpBucketKey(new Headers({ "x-forwarded-for": ip }), true);
  keys.push(key);
  await consumeRateLimit({ key, capacity: CAPACITY, refillPerMinute: CAPACITY }, 1, NOW);
  const [row] = await db.select().from(apiRateLimitBuckets).where(eq(apiRateLimitBuckets.bucketKey, key));
  expect(row.bucketKey).toMatch(/^ip:[a-f0-9]{64}$/);
  expect(JSON.stringify(row)).not.toContain(ip);
});
