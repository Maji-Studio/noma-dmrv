import { randomUUID } from "node:crypto";
import { env } from "@/config/env";
import {
  WALKTHROUGH_LOCAL_ORIGINS,
  WALKTHROUGH_MAX_BODY_BYTES,
  WALKTHROUGH_ORIGINS,
  WALKTHROUGH_PREFLIGHT_MAX_AGE_SECONDS,
  WALKTHROUGH_PREVIEW_ORIGIN,
  WALKTHROUGH_RATE_LIMIT,
  WALKTHROUGH_STATUS as STATUS,
} from "@/config/walkthrough";
import { consumeRateLimit } from "@/data-access/api-rate-limits";
import { clientIpBucketKey } from "@/lib/api/client-ip";
import { sendEmail } from "@/lib/email/send";
import { walkthroughRequestEmail } from "@/lib/email/templates/walkthrough-request-email";
import { logger } from "@/lib/log";
import { walkthroughSchema } from "@/schemas/walkthrough";

export const runtime = "nodejs";

function responseContext(request: Request) {
  const requestId = randomUUID();
  const origin = request.headers.get("Origin");
  const allowed = origin !== null && (
    WALKTHROUGH_ORIGINS.includes(origin) || WALKTHROUGH_PREVIEW_ORIGIN.test(origin) ||
    (env.NODE_ENV !== "production" && WALKTHROUGH_LOCAL_ORIGINS.includes(origin))
  );
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId });
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return {
    allowed,
    headers,
    json(status: number, body: object, outcome: string, emailId?: string) {
      const context = { requestId, outcome, ...(emailId ? { emailId } : {}) };
      if (status === STATUS.unavailable) logger.warn(context, "walkthrough request");
      else if (status === STATUS.sendFailed) logger.error(context, "walkthrough request");
      else logger.info(context, "walkthrough request");
      return Response.json(body, { status, headers });
    },
  };
}

type BodyResult = { ok: true; value: unknown } | { ok: false; error: "too_large" | "invalid" };

/** Enforce the byte cap while streaming, even without an honest Content-Length. */
async function readBody(request: Request): Promise<BodyResult> {
  if (Number(request.headers.get("Content-Length")) > WALKTHROUGH_MAX_BODY_BYTES) {
    return { ok: false, error: "too_large" };
  }
  if (!request.body) return { ok: false, error: "invalid" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let raw = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > WALKTHROUGH_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: "too_large" };
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

export async function OPTIONS(request: Request): Promise<Response> {
  const response = responseContext(request);
  if (!response.allowed) return response.json(STATUS.forbidden, { error: "forbidden" }, "forbidden");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", String(WALKTHROUGH_PREFLIGHT_MAX_AGE_SECONDS));
  return new Response(null, { status: STATUS.preflight, headers: response.headers });
}

export async function POST(request: Request): Promise<Response> {
  const response = responseContext(request);
  if (!response.allowed) return response.json(STATUS.forbidden, { error: "forbidden" }, "forbidden");

  // Every allowed-origin attempt costs a token, including malformed bodies and bots.
  try {
    const rate = await consumeRateLimit({
      key: `walkthrough:${clientIpBucketKey(request.headers)}`,
      ...WALKTHROUGH_RATE_LIMIT,
    });
    if (!rate.allowed) {
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response.json(STATUS.rateLimited, { error: "rate_limited" }, "rate_limited");
    }
  } catch {
    return response.json(STATUS.unavailable, { error: "unavailable" }, "rate_limit_unavailable");
  }

  const body = await readBody(request);
  if (!body.ok) {
    if (body.error === "too_large") return response.json(STATUS.tooLarge, { error: "too_large" }, "too_large");
    return response.json(STATUS.invalid, { error: "invalid", fields: [] }, "invalid");
  }
  const parsed = walkthroughSchema.safeParse(body.value);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.flatMap(issue =>
      typeof issue.path[0] === "string" ? [issue.path[0]] : [],
    ))];
    return response.json(STATUS.invalid, { error: "invalid", fields }, "invalid");
  }
  const input = parsed.data;
  if (input.website) return response.json(STATUS.ok, { ok: true }, "honeypot");

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !env.WALKTHROUGH_TO) {
    return response.json(STATUS.unavailable, { error: "unavailable" }, "not_configured");
  }
  const email = walkthroughRequestEmail({ ...input, to: env.WALKTHROUGH_TO, appUrl: env.NEXT_PUBLIC_APP_URL });
  try {
    const result = await sendEmail({
      type: "walkthrough-request",
      to: env.WALKTHROUGH_TO,
      replyTo: input.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (!result.sent) {
      return result.reason === "not-configured"
        ? response.json(STATUS.unavailable, { error: "unavailable" }, "not_configured")
        : response.json(STATUS.sendFailed, { error: "send_failed" }, "send_failed");
    }
    return response.json(STATUS.ok, { ok: true }, "sent", result.id);
  } catch {
    return response.json(STATUS.sendFailed, { error: "send_failed" }, "send_failed");
  }
}
