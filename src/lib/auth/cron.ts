import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";

/** Machine-route gate. Hash both values to compare equal-length buffers. */
export function authorizeCronRequest(request: Request): Response | null {
  const headers = { "Cache-Control": "private, no-store" };
  if (!env.CRON_SECRET) return new Response(null, { status: 503, headers });
  const supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${env.CRON_SECRET}`).digest();
  return timingSafeEqual(supplied, expected) ? null : new Response(null, { status: 401, headers });
}
