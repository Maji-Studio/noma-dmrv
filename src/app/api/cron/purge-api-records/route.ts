import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { purgeExpiredIdempotencyRecords } from "@/data-access/api-idempotency-records";
import { purgeIdleRateLimitBuckets } from "@/data-access/api-rate-limits";
import { logger } from "@/lib/log";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  if (!env.CRON_SECRET) return new Response(null, { status: 503, headers });
  const supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${env.CRON_SECRET}`).digest();
  if (!timingSafeEqual(supplied, expected)) return new Response(null, { status: 401, headers });
  const now = new Date();
  const idempotencyRecords = await purgeExpiredIdempotencyRecords(now);
  const rateLimitBuckets = await purgeIdleRateLimitBuckets(now);
  const counts = { idempotencyRecords, rateLimitBuckets };
  logger.info(counts, "API records purged");
  return Response.json(counts, { headers });
}
