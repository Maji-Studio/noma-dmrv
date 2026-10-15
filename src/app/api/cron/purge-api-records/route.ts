import { authorizeCronRequest } from "@/lib/auth/cron";
import { purgeExpiredIdempotencyRecords } from "@/data-access/api-idempotency-records";
import { purgeIdleRateLimitBuckets } from "@/data-access/api-rate-limits";
import { logger } from "@/lib/log";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  const denied = authorizeCronRequest(request);
  if (denied) return denied;
  const now = new Date();
  const idempotencyRecords = await purgeExpiredIdempotencyRecords(now);
  const rateLimitBuckets = await purgeIdleRateLimitBuckets(now);
  const counts = { idempotencyRecords, rateLimitBuckets };
  logger.info(counts, "API records purged");
  return Response.json(counts, { headers });
}
