import { env } from "@/config/env";
import { API_RATE_LIMITS } from "@/config/api-rate-limits";
import { consumeRateLimit, type RateLimitResult } from "@/data-access/api-rate-limits";
import type { ApiContext } from "@/lib/auth/api-context";
import { clientIpBucketKey } from "./client-ip";
import { problemResponse, rateLimitHeaders } from "./problem";

type RequestInfo = { requestId: string; instance: string };

function bypassLimits(): boolean {
  return env.NODE_ENV !== "production" && process.env.DISABLE_RATE_LIMIT === "true";
}


function limitedResponse(result: RateLimitResult, info: RequestInfo): Response {
  const response = problemResponse({
    ...info, status: 429, code: "rate_limited", detail: "Too many requests. Try again later.",
    retryable: true, retryAfterSeconds: Math.max(1, result.retryAfterSeconds),
  });
  rateLimitHeaders(result).forEach((value, key) => response.headers.set(key, value));
  return response;
}

export async function preAuthGuard(
  request: Request,
  info: RequestInfo,
): Promise<{ response: Response | null; result: RateLimitResult | null }> {
  if (bypassLimits()) return { response: null, result: null };
  const result = await consumeRateLimit({
    key: clientIpBucketKey(request.headers), capacity: API_RATE_LIMITS.ip, refillPerMinute: API_RATE_LIMITS.ip,
  });
  return { response: result.allowed ? null : limitedResponse(result, info), result };
}

export async function postAuthGuard(
  ctx: ApiContext,
  options: RequestInfo & { access: "read" | "write"; writesDisabledInHandler?: boolean },
  ipResult: RateLimitResult | null,
): Promise<{ ok: false; response: Response } | { ok: true; headers: Headers }> {
  const { access } = options;
  if (access === "write" && env.API_WRITES_DISABLED && !options.writesDisabledInHandler) {
    return { ok: false, response: problemResponse({
      ...options, status: 503, code: "api_writes_disabled", detail: "API writes are temporarily disabled.", retryable: true,
    }) };
  }
  if (bypassLimits()) return { ok: true, headers: new Headers() };
  const results: RateLimitResult[] = ipResult ? [ipResult] : [];
  for (const [kind, id] of [["credential", ctx.credentialId], ["organization", ctx.organizationId]] as const) {
    const capacity = API_RATE_LIMITS[kind][access];
    const result = await consumeRateLimit({ key: `${kind}:${id}:${access}`, capacity, refillPerMinute: capacity });
    results.push(result);
    if (!result.allowed) return { ok: false, response: limitedResponse(result, options) };
  }
  // Equal request costs: the fewest remaining requests is the tightest bucket.
  const tightest = results.reduce((a, b) => a.remaining <= b.remaining ? a : b);
  return { ok: true, headers: rateLimitHeaders(tightest) };
}
