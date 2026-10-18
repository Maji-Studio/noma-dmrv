import { purgeExpiredOAuthAttempts, purgePendingOAuthGrants, purgeExpiredOAuthTokens, purgeExpiredOAuthClientAssertions } from "@/data-access/oauth-purge";
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
  const oauthAttempts = await purgeExpiredOAuthAttempts(now);
  const oauthPendingGrants = await purgePendingOAuthGrants(now);
  const oauthTokens = await purgeExpiredOAuthTokens(now);
  const oauthClientAssertions = await purgeExpiredOAuthClientAssertions(now);
  const counts = { idempotencyRecords, rateLimitBuckets, oauthAttempts, oauthPendingGrants, oauthTokens, oauthClientAssertions };
  logger.info(counts, "API records purged");
  return Response.json(counts, { headers });
}
