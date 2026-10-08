/** DB suite: run after the reviewer generates/applies schema changes. */
import { afterEach, beforeEach, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { apiIdempotencyRecords, apiRateLimitBuckets } from "@/db/schema";
import { purgeExpiredIdempotencyRecords } from "@/data-access/api-idempotency-records";
import { purgeIdleRateLimitBuckets } from "@/data-access/api-rate-limits";
import { API_RECORD_PURGE_BATCH_SIZE, IDEMPOTENCY_OUTCOME_SCHEMA_VERSION } from "@/config/operations";
import { RATE_LIMIT_IDLE_RETENTION_MS } from "@/config/api-rate-limits";
import { createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "./helpers/operation-fixture";

let fixture: IntakeFixture;
let keys: string[];
// Historical clock avoids purging other suites' current records.
const NOW = new Date("2000-01-02T00:00:00Z");
beforeEach(async () => { fixture = await createIntakeFixture("purge"); keys = []; });
afterEach(async () => {
  if (keys.length) await db.delete(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, keys));
  await removeIntakeFixture(fixture);
});
it("removes expired records across multiple bounded batches and keeps a live record", async () => {
  const expiredCount = API_RECORD_PURGE_BATCH_SIZE + 1;
  const records = Array.from({ length: expiredCount + 1 }, (_, index) => ({
    organizationId: fixture.ctx.organizationId, credentialId: "purge", idempotencyKey: String(index),
    operationId: "test", fingerprint: "test", outcomeSchemaVersion: IDEMPOTENCY_OUTCOME_SCHEMA_VERSION,
    expiresAt: new Date(NOW.getTime() + (index === expiredCount ? 1 : 0)),
  }));
  await db.insert(apiIdempotencyRecords).values(records);
  expect(await purgeExpiredIdempotencyRecords(NOW)).toBeGreaterThanOrEqual(expiredCount);
  const kept = await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, fixture.ctx.organizationId));
  expect(kept.map((row) => row.idempotencyKey)).toEqual([String(expiredCount)]);
});
it("removes idle buckets at the cutoff across batches and keeps recently used buckets", async () => {
  const idleCount = API_RECORD_PURGE_BATCH_SIZE + 1;
  keys = Array.from({ length: idleCount + 1 }, () => `credential:${crypto.randomUUID()}:read`);
  await db.insert(apiRateLimitBuckets).values(keys.map((key, index) => ({
    bucketKey: key, tokens: 0,
    refilledAt: new Date(NOW.getTime() - RATE_LIMIT_IDLE_RETENTION_MS + (index === idleCount ? 1 : 0)),
  })));
  expect(await purgeIdleRateLimitBuckets(NOW)).toBeGreaterThanOrEqual(idleCount);
  const kept = await db.select().from(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, keys));
  expect(kept.map((row) => row.bucketKey)).toEqual([keys[idleCount]]);
});
