import { sql } from "drizzle-orm";
import { db } from "@/db";
import { API_RECORD_PURGE_BATCH_SIZE } from "@/config/operations";
import { RATE_LIMIT_IDLE_RETENTION_MS, RATE_LIMIT_SECONDS_PER_MINUTE } from "@/config/api-rate-limits";

export interface RateLimitBucket {
  key: string;
  capacity: number;
  refillPerMinute: number;
}
export interface RateLimitResult {
  allowed: boolean;
  /** Exact database timestamp text preserves sub-millisecond precision for refunds. */
  debitRefilledAt: string;
  limit: number;
  remaining: number;
  /** Seconds until the bucket is full again. */
  resetSeconds: number;
  /** Seconds until one more request of this cost is admitted; 0 when allowed now. */
  retryAfterSeconds: number;
}

function assertValidBucket(bucket: RateLimitBucket, cost: number): void {
  const { capacity, refillPerMinute } = bucket;
  if (![capacity, refillPerMinute, cost].every((value) => Number.isFinite(value) && value > 0) || cost > capacity) {
    throw new Error("Invalid rate-limit bucket or cost.");
  }
}

// org-scope-ok: system abuse protection spans unauthenticated IPs, credentials and organizations.
export async function consumeRateLimit(
  bucket: RateLimitBucket,
  cost = 1,
  now?: Date,
): Promise<RateLimitResult> {
  assertValidBucket(bucket, cost);
  const { key, capacity, refillPerMinute } = bucket;
  // Production uses the database clock; tests inject a clock without sleeping.
  const instant = now ? sql`${now.toISOString()}::timestamptz` : sql`statement_timestamp()`;
  const available = (row: "api_rate_limit_buckets" | "previous") => sql`
    least(${capacity}::double precision, ${sql.raw(`${row}.tokens`)} +
      greatest(0, extract(epoch from (${instant} - ${sql.raw(`${row}.refilled_at`)}))) *
      ${refillPerMinute}::double precision / ${RATE_LIMIT_SECONDS_PER_MINUTE})`;
  // PostgreSQL 18's OLD/NEW RETURNING aliases expose the row locked by the
  // upsert, including after a concurrent debit. No snapshot pre-read can race.
  const result = await db.execute<{
    allowed: boolean;
    tokens: number;
    debit_refilled_at: string;
    refill_delay_seconds: number;
  }>(sql`
    insert into api_rate_limit_buckets (bucket_key, tokens, refilled_at)
    values (${key}, ${capacity - cost}, ${instant})
    on conflict (bucket_key) do update set
      tokens = ${available("api_rate_limit_buckets")} -
        case when ${available("api_rate_limit_buckets")} >= ${cost} then ${cost} else 0 end,
      refilled_at = greatest(api_rate_limit_buckets.refilled_at, ${instant})
    returning with (old as previous, new as current)
      (previous.bucket_key is null or ${available("previous")} >= ${cost}) as allowed,
      current.tokens,
      current.refilled_at::text as debit_refilled_at,
      -- After a backward clock step refill resumes only at the retained timestamp.
      greatest(0, extract(epoch from (current.refilled_at - ${instant})))::double precision as refill_delay_seconds
  `);
  const row = result.rows[0];
  return {
    allowed: row.allowed,
    debitRefilledAt: row.debit_refilled_at,
    limit: capacity,
    remaining: Math.floor(row.tokens),
    resetSeconds: Math.ceil(
      Number(row.refill_delay_seconds) + (capacity - row.tokens) * RATE_LIMIT_SECONDS_PER_MINUTE / refillPerMinute,
    ),
    retryAfterSeconds: row.tokens >= cost ? 0 : Math.ceil(
      Number(row.refill_delay_seconds) + (cost - row.tokens) * RATE_LIMIT_SECONDS_PER_MINUTE / refillPerMinute,
    ),
  };
}

/**
 * Return only the matching debit without resetting refill time or creating a bucket.
 * An intervening refused consume can advance refilled_at and cancel the refund (fail closed).
 */
// org-scope-ok: system abuse protection spans unauthenticated IPs, credentials and organizations.
export async function refundRateLimit(bucket: RateLimitBucket, debitRefilledAt: string, cost = 1): Promise<void> {
  assertValidBucket(bucket, cost);
  const { key, capacity } = bucket;
  await db.execute(sql`
    update api_rate_limit_buckets
    set tokens = least(${capacity}::double precision, tokens + ${cost}::double precision)
    where bucket_key = ${key} and refilled_at = ${debitRefilledAt}::timestamptz
  `);
}

// org-scope-ok: authenticated cron removes idle system buckets across all principals.
export async function purgeIdleRateLimitBuckets(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RATE_LIMIT_IDLE_RETENTION_MS);
  let count = 0;
  for (;;) {
    const result = await db.execute(sql`
      delete from api_rate_limit_buckets where bucket_key in (
        select bucket_key from api_rate_limit_buckets where refilled_at <= ${cutoff}
        order by refilled_at limit ${API_RECORD_PURGE_BATCH_SIZE} for update skip locked
      ) returning bucket_key
    `);
    count += result.rows.length;
    if (result.rows.length < API_RECORD_PURGE_BATCH_SIZE) return count;
  }
}
